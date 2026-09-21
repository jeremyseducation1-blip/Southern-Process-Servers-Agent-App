const { schedule } = require('@netlify/functions');
const { listOpenCases } = require('./lib/caseStore');
const { sendGmail } = require('./lib/sendGmail');

const KEVIN_EMAIL = process.env.KEVIN_EMAIL || 'kevin@example.com';

// Runs every Sunday at 8:00 AM Central time.
// Netlify's scheduled functions use UTC cron, with no DST awareness, so
// this has to be manually flipped twice a year:
//   - CDT (roughly mid-March -- early November): use 13:00 UTC for 8am Central
//   - CST (roughly early November -- mid-March): use 14:00 UTC for 8am Central
// Right now (as of this deploy) it's set to 13:00 UTC, which lands at
// 8:00 AM CDT. See README for the toggle note.
const handler = async () => {
  const openCases = await listOpenCases();

  // Numbered, not sorted by case number -- just list order as stored.
  const lines = openCases.map((c, i) => {
    const style = `${c.plaintiff || 'Unknown Plaintiff'} v. ${c.defendant || 'Unknown Defendant'}`;
    const attorneyLastName = (c.attorney || '').trim().split(/\s+/).slice(-1)[0] || c.attorney;

    // Multi-defendant cases: only list the defendant(s) still outstanding,
    // not ones already served.
    let defendantNote = '';
    if (Array.isArray(c.defendants) && c.defendants.length > 1) {
      const outstanding = c.defendants.filter((d) => !d.served).map((d) => d.name);
      if (outstanding.length) {
        defendantNote = ` (outstanding: ${outstanding.join(', ')})`;
      }
    }

    // Still open (affidavit tracking not done yet) but the return itself
    // already went out -- flag that so it doesn't read the same as a
    // case nobody's touched yet.
    const returnNote = c.returnSent
      ? ` [Return sent${c.returnDate ? ' ' + c.returnDate : ''} — affidavit still pending]`
      : '';

    return `${i + 1}. ${style} — Case No. ${c.caseNo || 'N/A'} — ${attorneyLastName}${defendantNote}${returnNote}`;
  });

  const text = openCases.length
    ? `Weekly inventory — open cases as of ${new Date().toLocaleDateString()}\n\n${lines.join('\n')}`
    : `Weekly inventory — no open cases this week.`;

  await sendGmail({
    to: KEVIN_EMAIL,
    subject: `Weekly Inventory — ${new Date().toLocaleDateString()}`,
    text,
    attachments: []
  });

  return { statusCode: 200, body: 'Inventory sent' };
};

exports.handler = schedule('0 13 * * 0', handler);
