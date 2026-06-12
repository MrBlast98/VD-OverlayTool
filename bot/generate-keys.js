#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ override: true, path: path.join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
let SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY || SUPABASE_KEY.length < 100) {
  try {
    const fs = require('fs');
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = raw.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
    if (m && m[1]) {
      SUPABASE_KEY = m[1].trim();
      console.log('Loaded SUPABASE_SERVICE_ROLE_KEY length (from file):', SUPABASE_KEY.length);
    }
  } catch (_) {}
} else {
  try { console.log('Loaded SUPABASE_SERVICE_ROLE_KEY length:', SUPABASE_KEY.length); } catch(_) {}
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in bot/.env');
  process.exit(1);
}

function generateRandomKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 32; i += 1) key += chars.charAt(Math.floor(Math.random() * chars.length));
  return key;
}

async function insertLicense(body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/license_keys`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text}`.trim());
  }

  return res.json().catch(() => null);
}

async function deleteLicenseByKey(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/license_keys?key=eq.${encodeURIComponent(String(key || '').trim())}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text}`.trim());
  }

  return res.json().catch(() => null);
}

function isSchemaMismatchError(err) {
  const m = String(err?.message || '').toLowerCase();
  return /used_at|activated_device_id|activated_at|column|schema|not null|null value/.test(m);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { amount: 1, dry: false, deleteMode: false, key: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--amount' || a === '-n') {
      args.amount = parseInt(argv[i + 1], 10) || 1;
      i++;
    } else if (a === '--key' || a === '-k') {
      args.key = argv[i + 1] || null;
      i++;
    } else if (a === '--delete' || a === '--remove') {
      args.deleteMode = true;
      if (!args.key && argv[i + 1] && !String(argv[i + 1]).startsWith('-')) {
        args.key = argv[i + 1];
        i++;
      }
    } else if (a === '--dry-run') {
      args.dry = true;
    } else if (!isNaN(Number(a))) {
      args.amount = parseInt(a, 10);
    } else if (!String(a).startsWith('-') && !args.key) {
      args.key = a;
    }
  }
  return args;
}

async function main() {
  const { amount, dry, deleteMode, key } = parseArgs();
  console.log(`Supabase project: ${SUPABASE_URL}`);

  if (deleteMode) {
    const targetKey = String(key || '').trim();
    if (!targetKey) {
      throw new Error('Paste the key to delete using --delete <key> or --key <key>.');
    }

    if (dry) {
      console.log(`Would delete key: ${targetKey}`);
      return;
    }

    const deleted = await deleteLicenseByKey(targetKey);
    console.log(`Deleted key: ${targetKey}`);
    if (Array.isArray(deleted) && deleted.length) {
      console.log(`Deleted rows: ${deleted.length}`);
    }
    return;
  }

  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error('Amount must be a positive whole number.');
  }
  console.log(`Dry run: ${dry ? 'yes' : 'no'}`);

  const created = [];
  for (let i = 0; i < amount; i++) {
    const key = generateRandomKey();
    if (dry) {
      console.log(`Would create key: ${key}`);
      created.push(key);
      continue;
    }

    try {
      const bodies = [
        {
          key,
          key_type: 'premium',
          used: false,
          used_at: null,
          activated_device_id: null,
          activated_at: null,
        },
        {
          key,
          key_type: 'premium',
          used: false,
          used_at: null,
        },
        {
          key,
          key_type: 'premium',
        },
      ];

      let inserted = false;
      for (const body of bodies) {
        try {
          await insertLicense(body);
          created.push(key);
          inserted = true;
          console.log(`Created key: ${key}`);
          break;
        } catch (err) {
          if (!isSchemaMismatchError(err)) throw err;
        }
      }

      if (!inserted) throw new Error('Failed to insert with any body variant');
    } catch (err) {
      console.error('Error creating key:', err.message || err);
    }
  }

  console.log(`Done. Created ${created.length} key(s).`);
  if (dry && created.length) console.log('Dry-run keys listed above.');
}

main().catch(err => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
