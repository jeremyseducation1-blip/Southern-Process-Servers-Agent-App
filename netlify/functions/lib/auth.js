// Simple single-user login.
//
// Set APP_PASSWORD in Netlify to turn the login ON. Until it is set, the app
// stays open exactly as before (so deploying this can never lock you out).
// Optional AUTH_SECRET signs the login tokens; without it a secret is derived
// from the password (changing the password signs every device out).
//
// A login token is "<expiry>.<signature>" and is checked on every request.
const crypto = require('crypto');

const TOKEN_DAYS = 60;

function authEnabled() {
  return !!process.env.APP_PASSWORD;
}

function secret() {
  return process.env.AUTH_SECRET || crypto.createHash('sha256').update('sps-auth|' + (process.env.APP_PASSWORD || '')).digest('hex');
}

function sign(expiry) {
  return crypto.createHmac('sha256', secret()).update(String(expiry)).digest('hex');
}

function issueToken() {
  const expiry = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;
  return `${expiry}.${sign(expiry)}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [expiry, sig] = token.split('.');
  if (!expiry || !sig || !/^\d+$/.test(expiry)) return false;
  if (Number(expiry) < Date.now()) return false;
  return safeEqual(sig, sign(expiry));
}

function checkPassword(pw) {
  return authEnabled() && safeEqual(String(pw || ''), process.env.APP_PASSWORD);
}

function tokenFromEvent(event) {
  const h = (event && event.headers) || {};
  const auth = h.authorization || h.Authorization || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return (event && event.queryStringParameters && event.queryStringParameters.auth) || '';
}

function isAuthorized(event) {
  return !authEnabled() || verifyToken(tokenFromEvent(event));
}

const DENIED = { statusCode: 401, headers: { 'Content-Type': 'text/plain' }, body: 'AUTH_REQUIRED' };

// opts.mandatory: refuse to run at all unless a login is configured
// (used for anything that spends money, like reading papers with AI).
function requireAuth(handler, opts = {}) {
  return async (event, context) => {
    if (opts.mandatory && !authEnabled()) {
      return { statusCode: 403, headers: { 'Content-Type': 'text/plain' }, body: 'LOGIN_NOT_CONFIGURED' };
    }
    if (!isAuthorized(event)) return DENIED;
    return handler(event, context);
  };
}

module.exports = { authEnabled, issueToken, verifyToken, checkPassword, isAuthorized, requireAuth, tokenFromEvent };
