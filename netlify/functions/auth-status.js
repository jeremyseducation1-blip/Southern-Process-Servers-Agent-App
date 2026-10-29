const { authEnabled, isAuthorized } = require('./lib/auth');
const { listCredentials } = require('./lib/passkeyStore');

// GET -> {required, ok, passkeys}: does this app need a login, is this device
// in, and is Face ID set up (so the sign-in screen can offer it)?
exports.handler = async (event) => {
  const required = authEnabled();
  const ok = isAuthorized(event);
  let passkeys = 0;
  if (required) { try { passkeys = (await listCredentials()).length; } catch (_) { /* ignore */ } }
  return { statusCode: 200, body: JSON.stringify({ required, ok, passkeys }) };
};
