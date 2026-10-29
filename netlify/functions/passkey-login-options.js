const { authEnabled, signedValue } = require('./lib/auth');
const { generateAuthenticationOptions } = require('@simplewebauthn/server');
const { listCredentials, relyingParty } = require('./lib/passkeyStore');

// No login needed (this IS the login). Only offers credentials already saved.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    if (!authEnabled()) return { statusCode: 400, body: 'Login is not turned on.' };
    const creds = await listCredentials();
    if (!creds.length) return { statusCode: 404, body: 'No Face ID set up yet.' };
    const { rpID } = relyingParty(event);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports }))
    });
    return { statusCode: 200, body: JSON.stringify({ options, ch: signedValue(options.challenge, 5 * 60 * 1000) }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Could not start Face ID' };
  }
};
