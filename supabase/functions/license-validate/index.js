const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function getConfig() {
  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');

  return { supabaseUrl, serviceRoleKey };
}

function serviceHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function fetchLicenseByKey(supabaseUrl, serviceRoleKey, key) {
  return fetch(
    `${supabaseUrl}/rest/v1/license_keys?key=eq.${encodeURIComponent(key)}&select=*`,
    {
      method: 'GET',
      headers: serviceHeaders(serviceRoleKey),
    },
  );
}

async function patchLicenseById(supabaseUrl, serviceRoleKey, id, body) {
  return fetch(
    `${supabaseUrl}/rest/v1/license_keys?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(serviceRoleKey),
      body: JSON.stringify(body),
    },
  );
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const { supabaseUrl, serviceRoleKey } = getConfig();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: 'Missing Supabase function configuration.' }, 500);
  }

  const body = await readJson(req);
  const key = String(body?.key || '').trim();
  const installId = String(body?.installId || '').trim();

  if (!key) {
    return jsonResponse({ ok: false, error: 'Missing license key.' }, 400);
  }

  if (!installId) {
    return jsonResponse({ ok: false, error: 'Missing install identifier.' }, 400);
  }

  const lookupResponse = await fetchLicenseByKey(supabaseUrl, serviceRoleKey, key);
  if (!lookupResponse.ok) {
    const text = await lookupResponse.text().catch(() => '');
    return jsonResponse({ ok: false, error: `License lookup failed: ${lookupResponse.status} ${text}`.trim() }, 502);
  }

  const rows = await lookupResponse.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ ok: false, error: 'Invalid key.' }, 404);
  }

  const record = rows[0] || {};
  const keyType = String(record.key_type || 'free');
  const activationId = String(record.activated_device_id || record.device_id || record.install_id || '').trim();
  const now = new Date().toISOString();

  if (keyType === 'premium') {
    if (activationId && activationId !== installId) {
      return jsonResponse({ ok: false, error: 'This premium key is already activated on another device.' }, 409);
    }

    if (!record.used || !record.used_at || !activationId) {
      const patchResponse = await patchLicenseById(supabaseUrl, serviceRoleKey, record.id, {
        used: true,
        used_at: now,
        activated_device_id: installId,
        activated_at: now,
      });

      if (!patchResponse.ok) {
        const text = await patchResponse.text().catch(() => '');
        return jsonResponse({ ok: false, error: `Failed to activate premium key: ${patchResponse.status} ${text}`.trim() }, 502);
      }
    }

    return jsonResponse({
      ok: true,
      keyType: 'premium',
      keyId: record.id,
      userId: record.id,
      activatedDeviceId: installId,
    });
  }

  if (record.used) {
    return jsonResponse({ ok: false, error: 'Key already used.' }, 409);
  }

  const patchResponse = await patchLicenseById(supabaseUrl, serviceRoleKey, record.id, {
    used: true,
    used_at: now,
  });

  if (!patchResponse.ok) {
    const text = await patchResponse.text().catch(() => '');
    return jsonResponse({ ok: false, error: `Failed to mark key used: ${patchResponse.status} ${text}`.trim() }, 502);
  }

  return jsonResponse({
    ok: true,
    keyType: 'free',
    keyId: record.id,
    userId: record.id,
  });
});