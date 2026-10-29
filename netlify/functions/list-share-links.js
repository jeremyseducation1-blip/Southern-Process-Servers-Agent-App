require('./lib/ensureWebSocket');
const { requireAuth } = require('./lib/auth');
const { createClient } = require('@supabase/supabase-js');
const { passwordsSetFor } = require('./lib/shareAuth');

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
  return createClient(url, key, { auth: { persistSession: false } });
}

exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const sb = client();
    const { data, error } = await sb.from('share_links').select('token, scope, label, created_at').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const siteUrl = process.env.URL || '';
    const has = await passwordsSetFor((data || []).map((r) => r.token));
    const links = (data || []).map((row) => ({
      ...row,
      hasPassword: !!has[row.token],
      url: `${siteUrl}/view.html?token=${row.token}`
    }));

    return { statusCode: 200, body: JSON.stringify({ links }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to list share links' };
  }
});
