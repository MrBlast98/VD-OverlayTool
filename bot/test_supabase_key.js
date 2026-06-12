const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

function fingerprint(k){ if(!k) return ''; return `${k.slice(0,8)}... len=${k.length} dots=${(k.match(/\./g)||[]).length}`; }

console.log(`Supabase URL: ${SUPABASE_URL}`);
console.log(`Supabase key fingerprint: ${fingerprint(SUPABASE_KEY)}`);

if(!SUPABASE_URL || !SUPABASE_KEY){ console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in bot/.env'); process.exit(1); }

(async ()=>{
  try{
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/license_keys`;
    const body = { key: `test-${Date.now()}`, kind: 'premium' };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(body)
    });
    console.log('Status', res.status);
    const text = await res.text();
    console.log('Response body:', text);
  }catch(err){
    console.error('Fetch error:', err);
  }
})();
