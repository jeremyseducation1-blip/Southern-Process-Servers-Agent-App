// Face ID / passkey credentials: public keys only (never anything secret),
// kept as one small private JSON file in Supabase Storage (bucket "passkeys",
// created automatically).
const { getSupabaseClient } = require('./caseStore');

const BUCKET = 'passkeys';
const PATH = 'credentials.json';
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

async function listCredentials() {
  const sb = getSupabaseClient();
  await ensureBucket(sb);
  const { data, error } = await sb.storage.from(BUCKET).download(PATH);
  if (error || !data) return [];
  try { const j = JSON.parse(await data.text()); return Array.isArray(j) ? j : []; } catch (_) { return []; }
}

async function saveCredentials(list) {
  const sb = getSupabaseClient();
  await ensureBucket(sb);
  const { error } = await sb.storage.from(BUCKET).upload(PATH, Buffer.from(JSON.stringify(list)), { contentType: 'application/json', upsert: true });
  if (error) throw new Error(error.message);
}

// Where is the app served from? The passkey is tied to this site's address.
function relyingParty(event) {
  const h = (event && event.headers) || {};
  let origin = h.origin || h.Origin || '';
  if (!origin && process.env.URL) origin = process.env.URL;
  if (!origin) origin = 'https://' + (h.host || h.Host || '');
  const u = new URL(origin);
  return { origin: u.origin, rpID: u.hostname };
}

module.exports = { listCredentials, saveCredentials, relyingParty };
