const { authEnabled, isAuthorized } = require('./lib/auth');

// GET -> {required, ok}: does this app need a login, and is this device in?
exports.handler = async (event) => ({
  statusCode: 200,
  body: JSON.stringify({ required: authEnabled(), ok: isAuthorized(event) })
});
