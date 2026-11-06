require('./lib/ensureWebSocket');
const { requireAuth } = require('./lib/auth');
const { getCase, putCase } = require('./lib/caseStore');
const { deleteCasePhoto } = require('./lib/returnStorage');

// POST {id, photo}
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { id, photo } = JSON.parse(event.body || '{}');
    if (!id || !photo) return { statusCode: 400, body: 'id and photo are required.' };
    const c = await getCase(id);
    const p = c && (c.photos || []).find((x) => x.id === photo);
    if (!p) return { statusCode: 404, body: 'No such photo.' };
    try { await deleteCasePhoto(p.path); } catch (e) { console.error('storage delete failed', e); }
    c.photos = c.photos.filter((x) => x.id !== photo);
    await putCase(c);
    return { statusCode: 200, body: JSON.stringify({ deleted: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to delete photo' };
  }
});
