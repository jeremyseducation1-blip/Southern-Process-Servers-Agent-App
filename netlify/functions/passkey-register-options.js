const { requireAuth, signedValue } = require('./lib/auth');
const { generateRegistrationOptions } = require('@simplewebauthn/server');
const { listCredentials, relyingParty } = require('./lib/passkeyStore');

// Signed in with the password -> start adding Face ID on this phone.
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { rpID } = relyingParty(event);
    const existing = await listCredentials();
    const options = await generateRegistrationOptions({
      rpName: 'Southern Process Servers',
      rpID,
      userName: 'jeremy',
      userDisplayName: 'Jeremy',
      userID: new TextEncoder().encode('sps-owner'),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' }
    });
    return { statusCode: 200, body: JSON.stringify({ options, ch: signedValue(options.challenge, 5 * 60 * 1000) }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Could not start Face ID setup' };
  }
}, { mandatory: true });
