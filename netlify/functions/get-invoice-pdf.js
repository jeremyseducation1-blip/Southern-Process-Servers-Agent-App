const { createClient } = require('@supabase/supabase-js');
const { getInvoicePdfUrl } = require('./lib/invoiceStore');
const { isAuthorized } = require('./lib/auth');

// Opened from the app (logged in) or from Kevin's ALL-scope share link.
async function shareLinkIsAll(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !url || !key) return false;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.from('share_links').select('scope').eq('token', token).maybeSingle();
  return !error && !!data && data.scope === 'ALL';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    if (!isAuthorized(event) && !(await shareLinkIsAll(event.queryStringParameters?.token))) {
      return { statusCode: 401, headers: { 'Content-Type': 'text/plain' }, body: 'AUTH_REQUIRED' };
    }
    const weekKey = event.queryStringParameters?.week;
    if (!weekKey) return { statusCode: 400, body: 'week is required.' };

    const url = await getInvoicePdfUrl(weekKey);
    return { statusCode: 200, body: JSON.stringify({ url }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to get invoice PDF' };
  }
};
