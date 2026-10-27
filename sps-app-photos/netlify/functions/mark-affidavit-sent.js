const { getCase, putCase } = require('./lib/caseStore');

// For cases where the affidavit was already handled outside this app
// (sent manually, or sent before the PDF generator was fixed) -- this
// just acknowledges that and closes the case out. It does NOT generate
// a PDF or send any email; it's purely a record-keeping correction so
// the case comes off the open-case inventory.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { id } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };

    const existing = await getCase(id);
    if (!existing) return { statusCode: 404, body: 'No case found with that id.' };

    existing.affidavitSent = true;
    existing.status = 'closed';
    existing.closedDate = new Date().toISOString();

    await putCase(existing);

    return { statusCode: 200, body: JSON.stringify({ updated: true, case: existing }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to mark affidavit sent' };
  }
};
