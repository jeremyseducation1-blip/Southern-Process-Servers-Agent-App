const { requireAuth } = require('./lib/auth');
const store = require('./lib/readingStore');
const { readPapers } = require('./lib/readPaper');

// Netlify runs functions named "-background" asynchronously (up to 15 min),
// answering the caller right away. The result is written to the job's file.
exports.handler = requireAuth(async (event) => {
  let jobId = '';
  try {
    jobId = JSON.parse(event.body || '{}').jobId;
    if (!/^[0-9a-f-]{36}$/.test(jobId || '')) return { statusCode: 400, body: 'Bad job.' };
    const images = await store.getInputs(jobId);
    const papers = await readPapers(images);
    await store.putResult(jobId, { status: 'done', papers });
  } catch (err) {
    console.error(err);
    if (jobId) { try { await store.putResult(jobId, { status: 'error', message: err.message || 'Reading failed' }); } catch (_) { /* nothing more to do */ } }
  } finally {
    if (jobId) { try { await store.removeJob(jobId, true); } catch (_) { /* inputs get purged later */ } }
  }
  return { statusCode: 200, body: 'ok' };
}, { mandatory: true });
