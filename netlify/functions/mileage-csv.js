const { requireAuth } = require('./lib/auth');
const { readStore } = require('./lib/mileageStore');

const IRS_RATE = { 2026: 0.725, 2025: 0.70, 2024: 0.67 }; // $/mile, IRS standard business rate
function weekStartOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return dt.toISOString().slice(0, 10);
}
const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

// GET ?year=2026 -> CSV of business trips for that year (for the accountant).
exports.handler = requireAuth(async (event) => {
  try {
    const year = (event.queryStringParameters && event.queryStringParameters.year) || '';
    const { trips } = await readStore();
    const rows = trips
      .filter((t) => !year || t.date.startsWith(year))
      .sort((a, b) => a.date.localeCompare(b.date));
    const total = rows.reduce((s, t) => s + t.miles, 0);
    const lines = [
      ['Date', 'Week of (Mon)', 'Business miles', 'Purpose', 'Stops (in order)', 'Note'].map(q).join(','),
      ...rows.map((t) => [t.date, weekStartOf(t.date), t.miles.toFixed(1), 'Process serving', (t.stops || []).join(' → '), t.note].map(q).join(',')),
      ['TOTAL', '', total.toFixed(1), '', '', ''].map(q).join(','),
      ...(IRS_RATE[year]
        ? [['Estimated deduction', '', '$' + (total * IRS_RATE[year]).toFixed(2), `IRS standard rate ${(IRS_RATE[year] * 100).toFixed(1)} cents/mile`, '', ''].map(q).join(',')]
        : [])
    ];
    const byWeek = new Map();
    rows.forEach((t) => { const k = weekStartOf(t.date); byWeek.set(k, (byWeek.get(k) || 0) + t.miles); });
    lines.push('', ['Weekly totals', 'Week of (Mon)', 'Business miles', '', '', ''].map(q).join(','));
    Array.from(byWeek.entries()).sort().forEach(([k, m]) => lines.push(['', k, m.toFixed(1), '', '', ''].map(q).join(',')));
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mileage-${year || 'all'}.csv"`
      },
      body: lines.join('\r\n')
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to build CSV' };
  }
});
