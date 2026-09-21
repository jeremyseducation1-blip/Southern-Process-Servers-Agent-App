const { createClient } = require('@supabase/supabase-js');

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Fields safe to hand to an outside viewer -- deliberately leaves out
// anything internal (signature data, raw photos, etc.).
function publicView(c) {
  return {
    caseNo: c.caseNo,
    caseType: c.caseType,
    plaintiff: c.plaintiff,
    defendant: c.defendant,
    defendants: c.defendants,
    attorney: c.attorney,
    courtType: c.courtType,
    county: c.county,
    state: c.state,
    status: c.status,
    intakeDate: c.intakeDate,
    serviceAddress: c.serviceAddress,
    returnSent: c.returnSent,
    returnDate: c.returnDate,
    returnOutcome: c.returnOutcome || null,
    affidavitSent: c.affidavitSent,
    closedDate: c.closedDate || null
  };
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
      .select('scope, label')
      .eq('token', token)
      .maybeSingle();
    if (linkError) throw new Error(linkError.message);
    if (!link) return { statusCode: 403, body: 'Invalid or expired link.' };

    let query = sb.from('cases').select('data');
    if (link.scope !== 'ALL') {
      query = query.ilike('attorney', link.scope);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const cases = (data || []).map((row) => publicView(row.data));

    return {
      statusCode: 200,
      body: JSON.stringify({ label: link.label, scope: link.scope, cases })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to load view' };
  }
};
