const { authEnabled, checkPassword, issueToken } = require('./lib/auth');

// POST {password} -> {token}. Wrong passwords wait a moment before answering,
// which makes guessing painfully slow.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!authEnabled()) return { statusCode: 200, body: JSON.stringify({ token: '', open: true }) };
  let password = '';
  try { password = JSON.parse(event.body || '{}').password; } catch (_) { /* treated as wrong */ }
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 1500));
    return { statusCode: 401, body: 'Wrong password.' };
  }
  return { statusCode: 200, body: JSON.stringify({ token: issueToken() }) };
};
