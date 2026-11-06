require('./lib/ensureWebSocket');
const { requireAuth } = require('./lib/auth');
const { getCase } = require('./lib/caseStore');
const { getCasePhotoUrl } = require('./lib/returnStorage');

exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { id, photo } = event.queryStringParameters || {};
    if (!id || !photo) return { statusCode: 400, body: 'id and photo are required.' };
    const c = await getCase(id);
    const p = c && (c.photos || []).find((x) => x.id === photo);
    if (!p) return { statusCode: 404, body: 'No such photo.' };
    return { statusCode: 200, body: JSON.stringify({ url: await getCasePhotoUrl(p.path), at: p.at }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to get photo' };
  }
});
