const crypto = require('crypto');
const { requireAuth } = require('./lib/auth');
const store = require('./lib/readingStore');

// POST {images:[dataUrl,...]} -> {jobId}. Saves the pages, then kicks off the
// background reader (which can take longer than a normal request allows).
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!process.env.ANTHROPIC_API_KEY) return { statusCode: 503, body: 'AI_NOT_CONFIGURED' };
  try {
    const { images } = JSON.parse(event.body || '{}');
    if (!Array.isArray(images) || !images.length) return { statusCode: 400, body: 'No pages sent.' };
    if (images.length > 8) return { statusCode: 400, body: 'Too many pages at once (8 max).' };

    const jobId = crypto.randomUUID();
    await store.purgeOld();
    for (let i = 0; i < images.length; i++) await store.putInput(jobId, i, images[i]);
    await store.putResult(jobId, { status: 'working' });

    const base = process.env.URL || `https://${event.headers.host}`;
    const hdr = event.headers.authorization || event.headers.Authorization || '';
    const kick = await fetch(`${base}/.netlify/functions/read-paper-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(hdr ? { Authorization: hdr } : {}) },
      body: JSON.stringify({ jobId })
    });
    if (!kick.ok && kick.status !== 202) {
      await store.putResult(jobId, { status: 'error', message: 'Could not start the reader (' + kick.status + ').' });
      return { statusCode: 502, body: 'Could not start the reader.' };
    }
    return { statusCode: 200, body: JSON.stringify({ jobId }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to start reading' };
  }
}, { mandatory: true });
