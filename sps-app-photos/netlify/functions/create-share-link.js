const crypto = require('crypto');
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
    const { scope, label } = JSON.parse(event.body || '{}');
    if (!scope) return { statusCode: 400, body: 'scope is required ("ALL" for Kevin, or an attorney name for a firm).' };

    const token = crypto.randomBytes(16).toString('hex');
    const sb = client();
    const { error } = await sb.from('share_links').insert({ token, scope, label: label || scope });
    if (error) throw new Error(error.message);

    const siteUrl = process.env.URL || ''; // Netlify sets this automatically at runtime
    return {
      statusCode: 200,
      body: JSON.stringify({ token, url: `${siteUrl}/view.html?token=${token}` })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to create share link' };
  }
};
