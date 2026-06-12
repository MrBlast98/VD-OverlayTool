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
    const base = SUPABASE_URL.replace(/\/$/, '');
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1) GET test
    const getUrl = `${base}/rest/v1/license_keys?select=key,kind&limit=1`;
    console.log('GET', getUrl);
    let res = await fetch(getUrl, { method: 'GET', headers });
    console.log('GET status', res.status);
    const getText = await res.text();
    console.log('GET body:', getText);

    // If GET OK, try POST
    if(res.status === 200){
      const key = `dev-premium-${Date.now()}`;
      const postUrl = `${base}/rest/v1/license_keys`;
      const body = { key, kind: 'premium' };
      console.log('POST', postUrl, 'body', body);
      res = await fetch(postUrl, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(body) });
      console.log('POST status', res.status);
      const postText = await res.text();
      console.log('POST body:', postText);
      if(res.ok) console.log('Created key:', key);
    } else {
      console.error('GET failed, aborting POST.');
    }
  }catch(err){
    console.error('Fetch error:', err);
  }
})();
