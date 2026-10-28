const { requireAuth } = require('./lib/auth');
const { getCase, putCase } = require('./lib/caseStore');

// Scheduled meetings with a defendant ("be at 1338 Sula Dr at 10:00 AM
// tomorrow"). They live on the case record itself, so the schedule always
// shows the case's address, phone numbers, notes, etc. with nothing to
// re-enter. Date and time are the Central-time wall-clock values as typed
// (YYYY-MM-DD and HH:MM, 24h) -- no timezone conversion to get wrong.
//
// POST { id, action, appointmentId?, date?, time?, note? }
//   add     - date, time required, note optional
//   update  - appointmentId + any of date/time/note (reschedule / edit)
//   done    - appointmentId (the meeting happened)
//   cancel  - appointmentId (it fell through)
//   delete  - appointmentId (entered by mistake)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { id, action, appointmentId, date, time, note } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };
    if (!['add', 'update', 'done', 'cancel', 'delete'].includes(action)) {
      return { statusCode: 400, body: 'action must be add, update, done, cancel or delete.' };
    }

    const existing = await getCase(id);
    if (!existing) return { statusCode: 404, body: 'No case found with that id.' };
    existing.appointments = Array.isArray(existing.appointments) ? existing.appointments : [];

    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 500) : undefined;

    if (action === 'add') {
      if (!DATE_RE.test(date || '')) return { statusCode: 400, body: 'A valid date is required.' };
      if (!TIME_RE.test(time || '')) return { statusCode: 400, body: 'A valid time is required.' };
      existing.appointments.push({
        id: newId(),
        date,
        time,
        note: cleanNote || '',
        status: 'scheduled',
        createdAt: new Date().toISOString()
      });
    } else {
      const appt = existing.appointments.find((a) => a.id === appointmentId);
      if (!appt) return { statusCode: 404, body: 'Meeting not found on this case.' };

      if (action === 'update') {
        if (date !== undefined) {
          if (!DATE_RE.test(date)) return { statusCode: 400, body: 'A valid date is required.' };
          appt.date = date;
        }
        if (time !== undefined) {
          if (!TIME_RE.test(time)) return { statusCode: 400, body: 'A valid time is required.' };
          appt.time = time;
        }
        if (cleanNote !== undefined) appt.note = cleanNote;
        appt.status = 'scheduled';
        appt.updatedAt = new Date().toISOString();
      } else if (action === 'done') {
        appt.status = 'done';
        appt.doneAt = new Date().toISOString();
      } else if (action === 'cancel') {
        appt.status = 'cancelled';
        appt.cancelledAt = new Date().toISOString();
      } else if (action === 'delete') {
        existing.appointments = existing.appointments.filter((a) => a.id !== appointmentId);
      }
    }

    await putCase(existing);
    return { statusCode: 200, body: JSON.stringify({ saved: true, appointments: existing.appointments }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to save meeting' };
  }
});
