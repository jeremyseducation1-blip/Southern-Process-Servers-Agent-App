const { requireAuth } = require('./lib/auth');
const { setPassword } = require('./lib/shareAuth');

// POST {token, password}: set or change the password on an existing link.
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { token, password } = JSON.parse(event.body || '{}');
    await setPassword(token, password);
    return { statusCode: 200, body: JSON.stringify({ saved: true }) };
  } catch (err) {
    return { statusCode: 400, body: err.message || 'Could not set the password' };
  }
});
