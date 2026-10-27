const { createClient } = require('@supabase/supabase-js');
const { listInvoices } = require('./lib/invoiceStore');

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
  return createClient(url, key, { auth: { persistSession: false } });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const token = event.queryStringParameters?.token;
    if (!token) return { statusCode: 400, body: 'Missing token.' };

    const sb = client();
    const { data: link, error: linkError } = await sb
      .from('share_links')
      .select('scope')
      .eq('token', token)
      .maybeSingle();
    if (linkError) throw new Error(linkError.message);
    if (!link) return { statusCode: 403, body: 'Invalid or expired link.' };

    // Invoices are Jeremy's overall billing, not scoped to one firm --
    // only Kevin's ALL-scope link gets to see them.
    if (link.scope !== 'ALL') {
      return { statusCode: 200, body: JSON.stringify({ invoices: [] }) };
    }

    const invoices = await listInvoices();
    return { statusCode: 200, body: JSON.stringify({ invoices }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to load invoices' };
  }
};
