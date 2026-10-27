const { getCase, putCase } = require('./lib/caseStore');
const { todayCentral } = require('./lib/billingDate');

// "I'm here" -- records that Jeremy (or his dad) was physically at the
// address, right now. The TIME is stamped on the server (not the phone's
// clock) and the location comes from the phone's GPS, so neither can be
// typed in or quietly changed afterward. Works whether or not the car is
// on -- it's just a tap at the door.
//
// Every tap is appended to `visits` (append-only log, never edited), and
// also fills the next open attempt slot (1-3) when there is one, so the
// attempt shows up in the case's attempt history with its GPS proof.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { id, lat, lng, accuracy, note } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { statusCode: 400, body: 'A valid GPS location is required.' };
    }

    const existing = await getCase(id);
    if (!existing) return { statusCode: 404, body: 'No case found with that id.' };

    const now = new Date();
    existing.visits = Array.isArray(existing.visits) ? existing.visits : [];

    existing.attempts = Array.isArray(existing.attempts) ? existing.attempts : [];

    // Double-tap guard: a second tap within 2 minutes is the same stop --
    // unless that stop's attempt was removed since (accidental tap), in
    // which case tapping again should work.
    const last = existing.visits[existing.visits.length - 1];
    const lastStillCounts = last && !last.removed;
    if (lastStillCounts && now - new Date(last.at) < 2 * 60 * 1000) {
      return { statusCode: 200, body: JSON.stringify({ duplicate: true, visit: last }) };
    }

    const cleanNote = typeof note === 'string' ? note.trim() : '';
    const visit = {
      at: now.toISOString(),
      lat,
      lng,
      accuracy: typeof accuracy === 'number' ? Math.round(accuracy) : null,
      note: cleanNote
    };
    existing.visits.push(visit);

    const taken = new Set(existing.attempts.map((a) => a.n));
    const nextN = [1, 2, 3].find((n) => !taken.has(n)) || null;
    let attempt = null;
    if (nextN) {
      attempt = {
        n: nextN,
        date: todayCentral(),
        // Left as typed -- NOT auto-filled -- because the affidavit prints
        // this note word for word.
        note: cleanNote,
        photoPath: null,
        photoTimestamp: null,
        visitAt: visit.at,
        lat,
        lng,
        accuracy: visit.accuracy
      };
      existing.attempts.push(attempt);
    }

    await putCase(existing);
    return { statusCode: 200, body: JSON.stringify({ recorded: true, visit, attempt, visitCount: existing.visits.length }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to record arrival' };
  }
};
