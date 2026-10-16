const { getCase, putCase } = require('./lib/caseStore');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    // `id` is the paper's unique row id (case numbers repeat, so aren't
    // enough on their own to identify one specific paper).
    const { id, fields } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };
    if (!fields || typeof fields !== 'object') return { statusCode: 400, body: 'fields is required.' };

    const existing = await getCase(id);
    if (!existing) return { statusCode: 404, body: 'No case found with that id.' };

    // Only these fields are editable after the fact -- case number itself
    // is left alone here (it's just a label now, not the lookup key, but
    // changing it wouldn't reflect in the row's id/storage paths, so it's
    // simplest to keep it fixed and log a new paper if it was truly wrong).
    const editable = ['courtType', 'county', 'state', 'caseType', 'plaintiff', 'defendant', 'defendants', 'serviceAddress', 'attorney', 'isAlias', 'notes', 'phoneNumbers', 'courtDate', 'issueDate'];
    const previousCourtDate = existing.courtDate || null;
    for (const key of editable) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        if (key === 'courtDate' || key === 'issueDate') {
          const v = typeof fields[key] === 'string' ? fields[key].trim() : '';
          if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
            return { statusCode: 400, body: `${key} must be a date (YYYY-MM-DD).` };
          }
          existing[key] = v || null;
        } else {
          existing[key] = fields[key];
        }
      }
    }

    // Court dates move. Keep a trail of what it was and when it changed.
    if ((existing.courtDate || null) !== previousCourtDate) {
      existing.courtDateHistory = Array.isArray(existing.courtDateHistory) ? existing.courtDateHistory : [];
      existing.courtDateHistory.push({ from: previousCourtDate, to: existing.courtDate || null, changedAt: new Date().toISOString() });
    }

    // Attorney or alias status may have just changed -- recompute whether
    // this case needs affidavit tracking, same rule as at intake.
    existing.needsAffidavitTracking =
      !!existing.isAlias && (existing.attorney || '').trim().toLowerCase() === 'scott weiss';

    await putCase(existing);

    return { statusCode: 200, body: JSON.stringify({ updated: true, case: existing }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to update case' };
  }
};
