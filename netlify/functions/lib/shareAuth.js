// Passwords for share links (Kevin's link, each law firm's link).
//
// Each link can have its own password. Hashes (never the passwords) live in
// one small private JSON file in Supabase Storage (bucket "share-auth"), so
// there is no database change to make. A link WITHOUT a password still works
// the old way (anyone with the link) until a password is set on it, so
// nothing breaks the moment this ships; the Share Links list flags those.
//
// After the password is entered once, the viewer page holds a signed session
// (30 days) and sends it with every request.
const crypto = require('crypto');
const { getSupabaseClient } = require('./caseStore');

const BUCKET = 'share-auth';
const PATH = 'passwords.json';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
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

async function readAll() {
  const sb = getSupabaseClient();
  await ensureBucket(sb);
  const { data, error } = await sb.storage.from(BUCKET).download(PATH);
  if (error || !data) return {};
  try { return JSON.parse(await data.text()) || {}; } catch (_) { return {}; }
}

async function writeAll(obj) {
  const sb = getSupabaseClient();
  await ensureBucket(sb);
  const { error } = await sb.storage.from(BUCKET).upload(PATH, Buffer.from(JSON.stringify(obj)), { contentType: 'application/json', upsert: true });
  if (error) throw new Error(error.message);
}

function hashPw(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

async function setPassword(token, password) {
  if (!token) throw new Error('token is required.');
  if (String(password || '').length < 6) throw new Error('Use at least 6 characters for a link password.');
  const all = await readAll();
  const salt = crypto.randomBytes(16).toString('hex');
  all[token] = { salt, hash: hashPw(password, salt) };
  await writeAll(all);
}

async function removePassword(token) {
  const all = await readAll();
  if (all[token]) { delete all[token]; await writeAll(all); }
}

async function passwordSet(token) {
  const all = await readAll();
  return !!all[token];
}

async function passwordsSetFor(tokens) {
  const all = await readAll();
  const out = {};
  tokens.forEach((t) => { out[t] = !!all[t]; });
  return out;
}

async function verifyPassword(token, password) {
  const all = await readAll();
  const rec = all[token];
  if (!rec) return null; // no password on this link
  const a = Buffer.from(hashPw(password, rec.salt), 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secret() {
  return crypto.createHash('sha256').update('sps-share|' + (process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev')).digest('hex');
}
// The signature covers the link's current password hash, so changing a
// link's password signs everyone out of it.
function sign(token, exp, pwHash) {
  return crypto.createHmac('sha256', secret()).update(token + '|' + exp + '|' + pwHash).digest('hex');
}
async function makeSession(token) {
  const all = await readAll();
  if (!all[token]) return null;
  const exp = Date.now() + SESSION_MS;
  return exp + '.' + sign(token, exp, all[token].hash);
}
function sessionValid(token, session, rec) {
  const [exp, sig] = String(session || '').split('.');
  if (!exp || !sig || !rec || !(Number(exp) > Date.now())) return false;
  const want = sign(token, exp, rec.hash);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

// Returns null when this request may see the link's data, otherwise a ready
// response. Links with no password set stay open (see top of file).
async function shareGate(token, event) {
  const rec = (await readAll())[token];
  if (!rec) return null;
  const headers = event.headers || {};
  const session = headers['x-share-auth'] || headers['X-Share-Auth'] || (event.queryStringParameters || {}).sa;
  if (sessionValid(token, session, rec)) return null;
  return { statusCode: 401, headers: { 'Content-Type': 'text/plain' }, body: 'SHARE_PASSWORD_REQUIRED' };
}

module.exports = { setPassword, removePassword, passwordSet, passwordsSetFor, verifyPassword, makeSession, shareGate };
