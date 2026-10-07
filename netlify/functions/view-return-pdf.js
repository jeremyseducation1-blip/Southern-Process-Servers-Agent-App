const { createClient } = require('@supabase/supabase-js');
const { getCase } = require('./lib/caseStore');
const { getReturnPdfUrl } = require('./lib/returnStorage');

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Share-link version of get-case-pdf: Kevin's ALL link can open any
// case's return PDF; a firm link only the cases for its own attorney.
// Returns a short-lived signed URL, never a permanent one.
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const token = event.queryStringParameters?.token;
    const id = event.queryStringParameters?.id;
    if (!token || !id) return { statusCode: 400, body: 'Missing token or id.' };

    const { data: link, error } = await client()
      .from('share_links')
      .select('scope')
      .eq('token', token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!link) return { statusCode: 403, body: 'Invalid or expired link.' };

    const c = await getCase(id);
    if (!c) return { statusCode: 404, body: 'No case found.' };

    const norm = (v) => (v || '').trim().toLowerCase();
    if (link.scope !== 'ALL' && norm(c.attorney) !== norm(link.scope)) {
      return { statusCode: 403, body: 'This link does not cover that case.' };
    }
    if (!c.returnPdfPath) return { statusCode: 404, body: 'No return PDF on file for this case.' };

    const url = await getReturnPdfUrl(c.returnPdfPath);
    return { statusCode: 200, body: JSON.stringify({ url }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to get PDF' };
  }
};
