const { requireAuth } = require('./lib/auth');
const { getCase, putCase, makePaperId } = require('./lib/caseStore');

// Refile: a closed paper had to be refiled by the attorney (mistakes on the
// original). Makes a brand-new OPEN paper from the closed one so nothing has
// to be retyped. The old paper stays closed with its history; the new one
// starts clean (no attempts, return, or affidavit) and bills as its own job.
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { id, issueDate, courtDate } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };
    const old = await getCase(id);
    if (!old) return { statusCode: 404, body: 'No case found with that id.' };
    if (old.status !== 'closed') return { statusCode: 400, body: 'That paper is still open.' };

    const dateOk = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);
    const baseId = makePaperId(old.caseNo, old.defendant);
    const newId = `${baseId}::${Date.now()}`;
    const isAlias = !!old.isAlias;
    const attorney = old.attorney || '';

    const rec = {
      id: newId,
      caseNo: old.caseNo,
      caseType: old.caseType || '',
      courtType: old.courtType || '',
      county: old.county || '',
      state: old.state || '',
      plaintiff: old.plaintiff || '',
      defendant: old.defendant || '',
      defendants: (old.defendants && old.defendants.length ? old.defendants : [{ name: old.defendant || '' }])
        .map((d) => ({ name: d.name, served: false })),
      serviceAddress: old.serviceAddress || '',
      courtDate: dateOk(courtDate) || null,
      issueDate: dateOk(issueDate) || null,
      notes: old.notes || '',
      phoneNumbers: old.phoneNumbers || '',
      attorney,
      isAlias,
      needsAffidavitTracking: isAlias && attorney.trim().toLowerCase() === 'scott weiss',
      status: 'open',
      intakeDate: new Date().toISOString(),
      closedDate: null,
      returnSent: false,
      affidavitSent: false,
      returnDate: null,
      refiledFrom: old.id
    };
    await putCase(rec);
    return { statusCode: 200, body: JSON.stringify({ created: true, case: rec }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Refile failed' };
  }
});
