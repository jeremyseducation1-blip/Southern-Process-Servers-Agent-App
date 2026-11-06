require('./lib/ensureWebSocket');
const crypto = require('crypto');
const { requireAuth } = require('./lib/auth');
const { getCase, putCase } = require('./lib/caseStore');
const { uploadCasePhoto } = require('./lib/returnStorage');

// Adds one photo to a case (any number of them over time). The phone shrinks
// each picture before sending, one request per picture.
// POST {id, image: "data:image/jpeg;base64,...", takenAt?}
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { id, image, takenAt } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };
    const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/s.exec(String(image || ''));
    if (!m) return { statusCode: 400, body: 'Send a JPEG or PNG image.' };
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 4.5 * 1024 * 1024) return { statusCode: 413, body: 'That picture is too large.' };

    const c = await getCase(id);
    if (!c) return { statusCode: 404, body: 'No case found with that id.' };
    c.photos = Array.isArray(c.photos) ? c.photos : [];
    if (c.photos.length >= 60) return { statusCode: 400, body: 'This case has hit its 60 photo limit.' };

    const photoId = crypto.randomBytes(6).toString('hex');
    const path = await uploadCasePhoto(id, photoId, buf, m[1]);
    const photo = { id: photoId, path, at: new Date().toISOString(), takenAt: takenAt || null };
    c.photos.push(photo);
    await putCase(c);
    return { statusCode: 200, body: JSON.stringify({ photo }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to add photo' };
  }
});
