const { getCase } = require('./lib/caseStore');

// "Add to calendar" -- GET ?id=<caseId>&appt=<appointmentId> returns a .ics
// file. Opening it on an iPhone/Android offers to add it to the phone's own
// calendar (which then does the alerts). Times are "floating" (no timezone),
// so the event lands at the same wall-clock time on the phone.
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d, t) => d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { id, appt } = event.queryStringParameters || {};
    if (!id || !appt) return { statusCode: 400, body: 'id and appt are required.' };
    const c = await getCase(id);
    if (!c) return { statusCode: 404, body: 'No case found with that id.' };
    const a = (c.appointments || []).find((x) => x.id === appt);
    if (!a) return { statusCode: 404, body: 'Appointment not found.' };

    const [h, m] = a.time.split(':').map(Number);
    const endMin = h * 60 + m + 30;
    const endTime = endMin >= 1440 ? '23:59' : `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    const names = Array.isArray(c.defendants) && c.defendants.length
      ? c.defendants.map((d) => d.name).filter(Boolean).join(', ') : (c.defendant || 'Defendant');
    const desc = [
      a.note && `Meeting note: ${a.note}`,
      `Case No. ${c.caseNo || 'N/A'}${c.plaintiff ? ' - ' + c.plaintiff : ''}`,
      c.phoneNumbers && `Phone: ${c.phoneNumbers}`,
      c.notes && `Case notes: ${c.notes}`
    ].filter(Boolean).join('\n');

    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Southern Process Servers//Agent App//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${a.id}@sps-agent-app`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
      `DTSTART:${stamp(a.date, a.time)}`,
      `DTEND:${stamp(a.date, endTime)}`,
      `SUMMARY:${esc('Serve ' + names)}`,
      c.serviceAddress ? `LOCATION:${esc(c.serviceAddress)}` : null,
      `DESCRIPTION:${esc(desc)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Meeting in 1 hour', 'TRIGGER:-PT60M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    ].filter(Boolean).join('\r\n') + '\r\n';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="meeting.ics"' },
      body: ics
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to build calendar file' };
  }
};
