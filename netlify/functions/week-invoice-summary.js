const { requireAuth } = require('./lib/auth');
const { listAllCases } = require('./lib/caseStore');
const { summarizeWeeks } = require('./lib/buildWeekInvoicePdf');

// The list of invoice weeks, counted by the very same code that builds each
// week's PDF, so the number on the button always matches the invoice.
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const weeks = summarizeWeeks(await listAllCases());
    return { statusCode: 200, body: JSON.stringify({ weeks }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to load invoice weeks' };
  }
});
