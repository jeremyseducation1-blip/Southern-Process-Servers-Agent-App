require('./lib/ensureWebSocket');
const { requireAuth } = require('./lib/auth');
const { listAllCases } = require('./lib/caseStore');

// Every call / text Jeremy has made from the app, across all cases, newest
// first, each with the defendant and case it was for.
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const cases = await listAllCases();
    const rows = [];
    cases.forEach((c) => {
      (c.contactLog || []).forEach((e) => rows.push({
        at: e.at, type: e.type, number: e.number,
        caseId: c.id, defendant: c.defendant || '', caseNo: c.caseNo || '', plaintiff: c.plaintiff || ''
      }));
    });
    rows.sort((a, b) => (a.at < b.at ? 1 : -1));
    return { statusCode: 200, body: JSON.stringify({ contacts: rows }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to list contacts' };
  }
});
