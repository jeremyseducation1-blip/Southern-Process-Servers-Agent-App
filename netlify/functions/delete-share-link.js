const { createClient } = require('@supabase/supabase-js');

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
  return createClient(url, key, { auth: { persistSession: false } });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { token } = JSON.parse(event.body || '{}');
    if (!token) return { statusCode: 400, body: 'token is required.' };

    const sb = client();
    const { error } = await sb.from('share_links').delete().eq('token', token);
    if (error) throw new Error(error.message);

    return { statusCode: 200, body: JSON.stringify({ deleted: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to delete share link' };
  }
};
