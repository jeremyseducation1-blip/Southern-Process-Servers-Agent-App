const { authEnabled, issueToken, readSigned } = require('./lib/auth');
const { verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { listCredentials, saveCredentials, relyingParty } = require('./lib/passkeyStore');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const fail = async () => { await new Promise((r) => setTimeout(r, 1000)); return { statusCode: 401, headers: { 'Content-Type': 'text/plain' }, body: 'Face ID was not recognized.' }; };
  try {
    if (!authEnabled()) return { statusCode: 400, body: 'Login is not turned on.' };
    const { ch, response } = JSON.parse(event.body || '{}');
    const challenge = readSigned(ch);
    if (!challenge || !response) return fail();
    const creds = await listCredentials();
    const cred = creds.find((c) => c.id === response.id);
    if (!cred) return fail();
    const { origin, rpID } = relyingParty(event);
    const v = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: cred.id, publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')), counter: cred.counter || 0, transports: cred.transports }
    });
    if (!v.verified) return fail();
    cred.counter = v.authenticationInfo.newCounter;
    cred.lastUsedAt = new Date().toISOString();
    try { await saveCredentials(creds); } catch (_) { /* the sign-in still counts */ }
    return { statusCode: 200, body: JSON.stringify({ token: issueToken() }) };
  } catch (err) {
    console.error(err);
    return fail();
  }
};
