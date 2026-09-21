const { getCase, putCase } = require('./lib/caseStore');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    // `id` is the paper's unique row id (from Search Cases, where the
    // fetched case object already carries it) -- case numbers repeat, so
    // they're not enough on their own to identify one specific paper.
    const { id, returnDate, servedDefendants, returnOutcome } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };

    const existing = await getCase(id);
    if (!existing) return { statusCode: 404, body: 'No case found with that id.' };

    const effectiveReturnDate = returnDate || new Date().toISOString().slice(0, 10);
    const coveredNames = Array.isArray(servedDefendants) && servedDefendants.length
      ? servedDefendants
      : (existing.defendants || []).map((d) => d.name); // no selection given -- assume the whole case, same as before

    if (Array.isArray(existing.defendants)) {
      existing.defendants = existing.defendants.map((d) =>
        coveredNames.includes(d.name) ? { ...d, served: true, returnDate: effectiveReturnDate } : d
      );
    }
    existing.returns = Array.isArray(existing.returns) ? existing.returns : [];
    existing.returns.push({ defendants: coveredNames, date: effectiveReturnDate, pdfPath: null, outcome: returnOutcome || 'Served', note: 'Marked manually, no PDF' });

    existing.returnSent = true;
    existing.returnDate = effectiveReturnDate;
    existing.returnOutcome = returnOutcome || 'Served';

    const allServed =
      !Array.isArray(existing.defendants) ||
      existing.defendants.length === 0 ||
      existing.defendants.every((d) => d.served);
    if (!existing.needsAffidavitTracking && allServed) {
      existing.status = 'closed';
      existing.closedDate = new Date().toISOString();
    }

    await putCase(existing);

    return { statusCode: 200, body: JSON.stringify({ updated: true, case: existing }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to update case' };
  }
};
