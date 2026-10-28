const { requireAuth } = require('./lib/auth');
const { getCase, putCase } = require('./lib/caseStore');

// POST {id}: Jeremy has seen this case's notes (clears the "new" badge).
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { id } = JSON.parse(event.body || '{}');
    const c = await getCase(id);
    if (!c) return { statusCode: 404, body: 'No case found with that id.' };
    let changed = false;
    (c.notesLog || []).forEach((n) => { if (!n.readByJeremy) { n.readByJeremy = true; changed = true; } });
    if (changed) await putCase(c);
    return { statusCode: 200, body: JSON.stringify({ updated: changed }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to mark notes read' };
  }
});
