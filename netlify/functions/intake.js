const { putCase, getCase, makePaperId } = require('./lib/caseStore');

// Fires the moment a paper is received, before any attempts are made.
// This is what creates the case record that the rest of the app (attempts,
// return, weekly inventory) reads and writes against.
//
// Intake does NOT notify Kevin -- it's purely for Jeremy's own case
// tracking / inventory. Kevin only ever gets emailed on a return or a
// completed affidavit.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { caseInfo } = JSON.parse(event.body);

    if (!caseInfo || !caseInfo.caseNo) {
      return { statusCode: 400, body: 'Case number is required.' };
    }

    // Case numbers repeat -- a case with multiple defendants gets logged
    // as one intake per defendant, same case number each time, and a
    // case number can legitimately resurface later too (a reissued alias
    // summons for the SAME defendant, after the earlier paper closed).
    const baseId = makePaperId(caseInfo.caseNo, caseInfo.defendant);
    const existing = await getCase(baseId);
    let id = baseId;
    if (existing) {
      if (existing.status === 'open') {
        // Same case number + same defendant, and the earlier paper is
        // still open -- almost certainly a mistake (re-logging the same
        // paper), not a reissue, so this one gets blocked.
        return { statusCode: 409, body: 'This exact case number + defendant is already logged and still open. If this is really a new/separate paper, check the defendant name for a typo.' };
      }
      // The earlier paper's closed -- this is a legitimate reissue.
      // Give the new one its own id so it doesn't overwrite the history
      // of the one that already closed.
      id = `${baseId}::${Date.now()}`;
    }

    const attorney = caseInfo.attorney || 'Scott Weiss';
    const isAlias = !!caseInfo.isAlias;
    // Affidavit workflow only ever applies to alias summons for Scott Weiss.
    // Everything else can still be tracked (and shows on inventory if open)
    // but never triggers the attempts/affidavit gating.
    const needsAffidavitTracking =
      isAlias && attorney.trim().toLowerCase() === 'scott weiss';

    const caseRecord = {
      id,
      caseNo: caseInfo.caseNo,
      caseType: caseInfo.caseType || '',
      courtType: caseInfo.courtType || '',
      county: caseInfo.county || '',
      state: caseInfo.state || '',
      plaintiff: caseInfo.plaintiff || '',
      defendant: caseInfo.defendant || '',
      defendants: caseInfo.defendants && caseInfo.defendants.length
        ? caseInfo.defendants
        : [{ name: caseInfo.defendant || '', served: false }],
      serviceAddress: caseInfo.serviceAddress || '',
      notes: caseInfo.notes || '',
      phoneNumbers: caseInfo.phoneNumbers || '',
      attorney,
      isAlias,
      needsAffidavitTracking,
      status: 'open',
      intakeDate: new Date().toISOString(),
      closedDate: null,
      returnSent: false,
      affidavitSent: false,
      returnDate: null
    };

    await putCase(caseRecord);

    return { statusCode: 200, body: JSON.stringify({ created: true, case: caseRecord }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Intake failed' };
  }
};
