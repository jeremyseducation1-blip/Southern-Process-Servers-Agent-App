const { getCase, putCase } = require('./lib/caseStore');
const { todayCentral } = require('./lib/billingDate');

// Fixes a mistake on an already-marked return -- wrong date, wrong
// outcome, a note that needs updating -- without re-touching which
// defendants are marked served or whether the case is closed. Those were
// already handled correctly when the return was first marked; this is
// just correcting the record, not re-doing the mark.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { id, returnDate, returnOutcome, returnNotes, billThisWeek } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };
    if (!returnDate) return { statusCode: 400, body: 'returnDate is required.' };

    const existing = await getCase(id);
    if (!existing) return { statusCode: 404, body: 'No case found with that id.' };
    if (!existing.returnSent) return { statusCode: 400, body: 'This case has no return on file to edit yet.' };

    existing.returnDate = returnDate;
    existing.returnOutcome = returnOutcome || existing.returnOutcome || 'Served';
    existing.returnNotes = returnNotes || '';
    // Move this return onto TODAY's invoice (without changing its return
    // date) -- for a backlogged return that should have been billed already.
    if (billThisWeek) existing.completedDate = todayCentral();

    // Keep the most recent entry in the returns[] history log in sync too,
    // so anything reading that log (rather than the top-level fields)
    // reflects the correction as well.
    if (Array.isArray(existing.returns) && existing.returns.length) {
      const last = existing.returns[existing.returns.length - 1];
      last.date = returnDate;
      last.outcome = existing.returnOutcome;
      last.notes = existing.returnNotes;
    }

    await putCase(existing);

    return { statusCode: 200, body: JSON.stringify({ updated: true, case: existing }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to edit return' };
  }
};
