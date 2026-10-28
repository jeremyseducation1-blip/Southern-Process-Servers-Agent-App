const { requireAuth } = require('./lib/auth');
const { getCase, putCase } = require('./lib/caseStore');

// Removes one logged attempt from a case (wrong tap, duplicate, wrong
// house). The attempt disappears from the case and from the affidavit.
//
// The GPS visit log is append-only, so the underlying visit is NOT erased:
// it's flagged `removed` with a timestamp, which keeps an honest record of
// what happened while letting a fresh "Log attempt" tap work right away.
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { id, attemptNumber } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };
    if (![1, 2, 3].includes(attemptNumber)) return { statusCode: 400, body: 'attemptNumber must be 1, 2, or 3.' };

    const existing = await getCase(id);
    if (!existing) return { statusCode: 404, body: 'No case found with that id.' };

    const attempts = Array.isArray(existing.attempts) ? existing.attempts : [];
    const target = attempts.find((a) => a.n === attemptNumber);
    if (!target) return { statusCode: 404, body: `Attempt ${attemptNumber} not found on this case.` };

    existing.attempts = attempts.filter((a) => a.n !== attemptNumber);

    if (target.visitAt && Array.isArray(existing.visits)) {
      existing.visits = existing.visits.map((v) =>
        v.at === target.visitAt ? { ...v, removed: true, removedAt: new Date().toISOString() } : v
      );
    }

    await putCase(existing);
    return { statusCode: 200, body: JSON.stringify({ removed: true, attemptNumber, case: existing }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to remove attempt' };
  }
});
