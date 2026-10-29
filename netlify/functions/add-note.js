require('./lib/ensureWebSocket');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { getCase, putCase } = require('./lib/caseStore');
const { authEnabled, isAuthorized } = require('./lib/auth');
const { sendGmail } = require('./lib/sendGmail');
const { shareGate } = require('./lib/shareAuth');

// A running, append-only note log on each case: who said what, and when.
// Notes are never edited or deleted, so "it's in the notes" settles it.
//   Kevin  -> posts through his ALL-scope share link (token)
//   Jeremy -> posts from the signed-in app
// POST {id, text, token?}
async function isAllShareLink(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !url || !key) return false;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.from('share_links').select('scope').eq('token', token).maybeSingle();
  return !error && !!data && data.scope === 'ALL';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { id, text, token } = JSON.parse(event.body || '{}');
    let by;
    if (token && (await isAllShareLink(token))) {
      const blocked = await shareGate(token, event);
      if (blocked) return blocked;
      by = 'Kevin';
    }
    else if (isAuthorized(event)) by = 'Jeremy';
    else return { statusCode: 401, headers: { 'Content-Type': 'text/plain' }, body: 'AUTH_REQUIRED' };

    const body = String(text || '').trim();
    if (!id) return { statusCode: 400, body: 'id is required.' };
    if (!body) return { statusCode: 400, body: 'Write a note first.' };
    if (body.length > 2000) return { statusCode: 400, body: 'That note is too long (2000 characters max).' };

    const c = await getCase(id);
    if (!c) return { statusCode: 404, body: 'No case found with that id.' };

    const note = {
      id: crypto.randomBytes(6).toString('hex'),
      at: new Date().toISOString(),
      by,
      text: body,
      readByJeremy: by === 'Jeremy'
    };
    c.notesLog = Array.isArray(c.notesLog) ? c.notesLog : [];
    if (c.notesLog.length >= 500) return { statusCode: 400, body: 'This case has hit its note limit.' };
    c.notesLog.push(note);
    await putCase(c);

    // A note from Kevin lands in Jeremy's inbox too, so it shows up as a phone notification.
    let emailed = false;
    if (by === 'Kevin') {
      try {
        const to = process.env.NOTIFY_EMAIL || process.env.GMAIL_SENDER_EMAIL;
        if (to) {
          await sendGmail({
            to,
            subject: `Note from Kevin — ${c.caseNo || 'case'} ${c.defendant || ''}`.trim(),
            text: `Kevin left a note on ${c.caseNo || 'a case'} (${c.plaintiff || ''} v. ${c.defendant || ''}):\n\n${body}\n\nOpen the app → Today to see it and reply.`,
            attachments: []
          });
          emailed = true;
        }
      } catch (mailErr) {
        console.error('Note email failed (note itself was saved):', mailErr);
      }
    }
    return { statusCode: 200, body: JSON.stringify({ saved: true, note: { id: note.id, at: note.at, by, text: body }, emailed }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to save note' };
  }
};
