const { readStore } = require('./lib/mileageStore');

const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

// GET ?year=2026 -> CSV of business trips for that year (for the accountant).
exports.handler = async (event) => {
  try {
    const year = (event.queryStringParameters && event.queryStringParameters.year) || '';
    const { trips } = await readStore();
    const rows = trips
      .filter((t) => !year || t.date.startsWith(year))
      .sort((a, b) => a.date.localeCompare(b.date));
    const total = rows.reduce((s, t) => s + t.miles, 0);
    const lines = [
      ['Date', 'Business miles', 'Purpose', 'Stops (in order, round trip from home)', 'Note'].map(q).join(','),
      ...rows.map((t) => [t.date, t.miles.toFixed(1), 'Process serving', (t.stops || []).join(' → '), t.note].map(q).join(',')),
      ['TOTAL', total.toFixed(1), '', '', ''].map(q).join(',')
    ];
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
};
