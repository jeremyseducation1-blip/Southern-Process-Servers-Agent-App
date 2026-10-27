const { listAllCases } = require('./lib/caseStore');

// Read-only endpoint for Jeremy's own weekly log view. Returns every case
// on file (open and closed) so the front end can group them by the week
// they were received.
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const cases = await listAllCases();
    return { statusCode: 200, body: JSON.stringify({ cases }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to list cases' };
  }
};
