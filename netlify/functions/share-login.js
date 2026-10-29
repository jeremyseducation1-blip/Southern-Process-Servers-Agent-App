const { verifyPassword, makeSession } = require('./lib/shareAuth');

// POST {token, password} -> {session}. The viewer page keeps the session
// and sends it as x-share-auth on every request.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { token, password } = JSON.parse(event.body || '{}');
    if (!token) return { statusCode: 400, body: 'Missing token.' };
    const ok = await verifyPassword(token, password || '');
    if (ok === null) return { statusCode: 200, body: JSON.stringify({ open: true }) }; // no password on this link
    if (!ok) {
      await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
      return { statusCode: 401, headers: { 'Content-Type': 'text/plain' }, body: 'That password is not right.' };
    }
    return { statusCode: 200, body: JSON.stringify({ session: await makeSession(token) }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Login failed' };
  }
};
