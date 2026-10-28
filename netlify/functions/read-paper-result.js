const { requireAuth } = require('./lib/auth');
const store = require('./lib/readingStore');

// GET ?id=<jobId> -> {status:'working'|'done'|'error', papers?, message?}
// A finished result is removed once it has been handed over.
exports.handler = requireAuth(async (event) => {
  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!/^[0-9a-f-]{36}$/.test(id || '')) return { statusCode: 400, body: 'Bad job.' };
  try {
    const r = await store.getResult(id);
    if (!r) return { statusCode: 404, body: 'No such reading.' };
    if (r.status !== 'working') { try { await store.removeJob(id, false); } catch (_) { /* purged later */ } }
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to check reading' };
  }
}, { mandatory: true });
