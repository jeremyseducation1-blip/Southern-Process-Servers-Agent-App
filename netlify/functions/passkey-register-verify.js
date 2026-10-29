const { requireAuth, readSigned } = require('./lib/auth');
const { verifyRegistrationResponse } = require('@simplewebauthn/server');
const { listCredentials, saveCredentials, relyingParty } = require('./lib/passkeyStore');

exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { ch, response, name } = JSON.parse(event.body || '{}');
    const challenge = readSigned(ch);
    if (!challenge) return { statusCode: 400, body: 'That setup took too long — try again.' };
    const { origin, rpID } = relyingParty(event);
    const v = await verifyRegistrationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true
    });
    if (!v.verified || !v.registrationInfo) return { statusCode: 400, body: 'Could not verify Face ID.' };
    const c = v.registrationInfo.credential;
    const list = (await listCredentials()).filter((x) => x.id !== c.id);
    list.push({
      id: c.id,
      publicKey: Buffer.from(c.publicKey).toString('base64url'),
      counter: c.counter || 0,
      transports: c.transports || response?.response?.transports || [],
      name: String(name || 'This phone').slice(0, 60),
      createdAt: new Date().toISOString()
    });
    await saveCredentials(list);
    return { statusCode: 200, body: JSON.stringify({ saved: true, count: list.length }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 400, body: err.message || 'Could not save Face ID' };
  }
}, { mandatory: true });
