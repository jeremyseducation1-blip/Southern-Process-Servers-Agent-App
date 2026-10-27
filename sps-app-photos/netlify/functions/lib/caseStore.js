// Shared case data store, backed by Supabase (Postgres).
//
// IMPORTANT: case numbers repeat. Jeremy's actual workflow tracks papers,
// not cases -- a case with 2 defendants gets logged as 2 separate intake
// entries (same case_no, different defendant), and the same case_no can
// also resurface in a later week (aliases/reissues). So case_no is NOT
// a unique key here. Every row has its own unique `id`, built from the
// case number + defendant name, and case_no is just a normal (non-unique,
// indexed) column you can look up or group by.
//
// Same exported interface as before for the read-everything functions
// (listOpenCases, listAllCases) so weekly-inventory.js, list-cases.js,
// and week-log-pdf.js keep working unchanged. getCase/putCase now take
// the row's unique `id` (see makePaperId) instead of a bare case number.

const { createClient } = require('@supabase/supabase-js');

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url && !key) {
    throw new Error(
      'Neither SUPABASE_URL nor SUPABASE_SERVICE_ROLE_KEY is set in this function\'s environment. ' +
      'Add both in Netlify: Site settings -> Environment variables, then redeploy.'
    );
  }
  if (!url) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is set, but SUPABASE_URL is missing. Add it in Netlify env vars and redeploy.');
  }
  if (!key) {
    throw new Error('SUPABASE_URL is set, but SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Netlify env vars and redeploy.');
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

// Builds the unique row id for one paper: case number + defendant name.
// This is what actually has to be unique, not the case number alone --
// two different defendants on the same case number are two different
// papers, and the same case number can legitimately show up again later
// (a reissue) without colliding with the earlier entry.
function makePaperId(caseNo, defendant) {
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${norm(caseNo)}::${norm(defendant)}`;
}

async function getCase(id) {
  const sb = client();
  const { data, error } = await sb.from('cases').select('data').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? data.data : null;
}

// All rows sharing a case number -- there can be more than one now
// (multiple defendants entered separately, or a reissued case number).
async function getCasesByCaseNo(caseNo) {
  const sb = client();
  const { data, error } = await sb.from('cases').select('data').eq('case_no', caseNo);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.data);
}

// Finds the currently-open paper for this case number + defendant, if
// one exists. This matters because a reissue (same case number, same
// defendant, but the earlier paper already closed) creates a NEW row
// under a disambiguated id -- so "the row for this case+defendant" isn't
// always just the original base id anymore. Falls back to the base-id
// row (open or not) so the common single-paper case still works even if
// nothing's open (e.g. looking it up right after it just got closed).
async function getActivePaperByCaseAndDefendant(caseNo, defendant) {
  const baseId = makePaperId(caseNo, defendant);
  const matches = await getCasesByCaseNo(caseNo);
  const norm = (s) => (s || '').trim().toLowerCase();
  const sameDefendant = matches.filter((c) => norm(c.defendant) === norm(defendant));
  const openMatch = sameDefendant.find((c) => c.status === 'open');
  if (openMatch) return openMatch;
  // Nothing open -- fall back to the base id specifically, so callers get
  // a stable, predictable row rather than an arbitrary closed one.
  return await getCase(baseId);
}

async function putCase(caseRecord) {
  if (!caseRecord.id) {
    throw new Error('putCase requires caseRecord.id (use makePaperId(caseNo, defendant)).');
  }
  const sb = client();
  const { error } = await sb.from('cases').upsert({
    id: caseRecord.id,
    case_no: caseRecord.caseNo,
    attorney: caseRecord.attorney || null,
    status: caseRecord.status || null,
    intake_date: caseRecord.intakeDate || null,
    data: caseRecord,
    updated_at: new Date().toISOString()
  });
  if (error) throw new Error(error.message);
  return caseRecord;
}

async function listOpenCases() {
  const sb = client();
  const { data, error } = await sb.from('cases').select('data').eq('status', 'open');
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.data);
}

async function listAllCases() {
  const sb = client();
  const { data, error } = await sb.from('cases').select('data');
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.data);
}

module.exports = {
  getCase,
  getCasesByCaseNo,
  getActivePaperByCaseAndDefendant,
  putCase,
  listOpenCases,
  listAllCases,
  getSupabaseClient: client,
  makePaperId
};
