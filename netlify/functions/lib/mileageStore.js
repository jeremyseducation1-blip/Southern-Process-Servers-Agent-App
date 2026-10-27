// Mileage log + saved home address, kept as one small private JSON file in
// Supabase Storage (bucket "mileage"). Created automatically on first use,
// so there is no database setup. One user, low volume: read-modify-write.
const { getSupabaseClient } = require('./caseStore');

const BUCKET = 'mileage';
const PATH = 'mileage.json';
let ensured = false;

async function ensureBucket(sb) {
  if (ensured) return;
  const { data, error } = await sb.storage.listBuckets();
  if (error) throw new Error(error.message);
  if (!data.some((b) => b.name === BUCKET)) {
    const { error: e2 } = await sb.storage.createBucket(BUCKET, { public: false });
    if (e2 && !/already exists/i.test(e2.message || '')) throw new Error(e2.message);
  }
  ensured = true;
}

async function readStore() {
  const sb = getSupabaseClient();
  await ensureBucket(sb);
  const { data, error } = await sb.storage.from(BUCKET).download(PATH);
  if (error || !data) return { home: '', trips: [] }; // first use: nothing saved yet
  try {
    const parsed = JSON.parse(await data.text());
    return { home: parsed.home || '', trips: Array.isArray(parsed.trips) ? parsed.trips : [] };
  } catch (_) {
    return { home: '', trips: [] };
  }
}

async function writeStore(store) {
  const sb = getSupabaseClient();
  await ensureBucket(sb);
  const { error } = await sb.storage.from(BUCKET).upload(PATH, Buffer.from(JSON.stringify(store)), {
    contentType: 'application/json',
    upsert: true
  });
  if (error) throw new Error(error.message);
}

module.exports = { readStore, writeStore };
