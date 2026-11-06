require('./lib/ensureWebSocket');
const crypto = require('crypto');
const { requireAuth } = require('./lib/auth');
const { getCase, putCase } = require('./lib/caseStore');

// Call / text log on each case: every time Jeremy taps Call or Text on a
// defendant's number from the app, it is stamped here with the number and
// the time, so the number never has to be saved in his phone.
// POST {id, type: 'call'|'text', number}
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { id, type, number } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };
    if (type !== 'call' && type !== 'text') return { statusCode: 400, body: 'type must be call or text.' };
    const digits = String(number || '').replace(/\D/g, '').slice(-15);
    if (digits.length < 10) return { statusCode: 400, body: 'A phone number is required.' };

    const c = await getCase(id);
    if (!c) return { statusCode: 404, body: 'No case found with that id.' };

    c.contactLog = Array.isArray(c.contactLog) ? c.contactLog : [];
    if (c.contactLog.length >= 500) return { statusCode: 400, body: 'This case has hit its call/text log limit.' };
    const entry = { id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), type, number: digits };
    c.contactLog.push(entry);
    await putCase(c);
    return { statusCode: 200, body: JSON.stringify({ entry }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to log contact' };
  }
});
