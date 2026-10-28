// Short-lived scratch space for papers being read: the page images and the
// result sit in a private bucket only until the app has picked them up.
const { getSupabaseClient } = require('./caseStore');
const BUCKET = 'readings';
let ensured = false;

async function bucket() {
  const sb = getSupabaseClient();
  if (!ensured) {
    const { data, error } = await sb.storage.listBuckets();
    if (error) throw new Error(error.message);
    if (!data.some((b) => b.name === BUCKET)) {
      const { error: e2 } = await sb.storage.createBucket(BUCKET, { public: false });
      if (e2 && !/already exists/i.test(e2.message || '')) throw new Error(e2.message);
    }
    ensured = true;
  }
  return sb.storage.from(BUCKET);
}

async function put(path, body, contentType) {
  const b = await bucket();
  const { error } = await b.upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(error.message);
}

async function putInput(jobId, i, dataUrl) {
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Bad image.');
  await put(`${jobId}/page-${i}.txt`, Buffer.from(dataUrl), 'text/plain');
}
async function getInputs(jobId) {
  const b = await bucket();
  const { data: files, error } = await b.list(jobId);
  if (error) throw new Error(error.message);
  const pages = files.filter((f) => /^page-\d+\.txt$/.test(f.name)).sort((a, c) => parseInt(a.name.slice(5)) - parseInt(c.name.slice(5)));
  const out = [];
  for (const f of pages) {
    const { data, error: e } = await b.download(`${jobId}/${f.name}`);
    if (e) throw new Error(e.message);
    out.push(await data.text());
  }
  return out;
}
const putResult = (jobId, obj) => put(`${jobId}/result.json`, Buffer.from(JSON.stringify(obj)), 'application/json');
async function getResult(jobId) {
  const b = await bucket();
  const { data, error } = await b.download(`${jobId}/result.json`);
  if (error || !data) return null;
  return JSON.parse(await data.text());
}
async function removeJob(jobId, onlyInputs) {
  const b = await bucket();
  const { data: files } = await b.list(jobId);
  const names = (files || []).filter((f) => !onlyInputs || f.name !== 'result.json').map((f) => `${jobId}/${f.name}`);
  if (names.length) await b.remove(names);
}
// Best-effort: remove anything left behind for more than a day.
async function purgeOld() {
  try {
    const b = await bucket();
    const { data: dirs } = await b.list('', { limit: 100 });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const d of dirs || []) {
      if (d.created_at && new Date(d.created_at).getTime() < cutoff) await removeJob(d.name, false);
    }
  } catch (_) { /* never block a reading over housekeeping */ }
}

module.exports = { putInput, getInputs, putResult, getResult, removeJob, purgeOld };
