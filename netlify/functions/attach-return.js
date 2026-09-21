const { getCase, putCase, makePaperId, getActivePaperByCaseAndDefendant } = require('./lib/caseStore');
const { uploadReturnPdf } = require('./lib/returnStorage');

// Attaches a return PDF to a case -- storage + case-record update only.
// Deliberately does NOT send any email. Kevin no longer gets notified by
// this step at all; the app is just recording that the paper came back,
// same as intake just records that a paper arrived.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { caseInfo, returnPdfBase64, returnDate, servedDefendants, returnOutcome } = JSON.parse(event.body);
    const effectiveReturnDate = returnDate || new Date().toISOString().slice(0, 10);

    if (!returnPdfBase64) {
      return { statusCode: 400, body: 'Missing return PDF.' };
    }
    if (!caseInfo?.caseNo) {
      return { statusCode: 400, body: 'Missing case number.' };
    }

    // Case numbers repeat -- find the currently-active paper for this
    // case number + defendant (handles a reissue correctly, where an
    // earlier closed paper shares the same case number and defendant).
    const activeCase = await getActivePaperByCaseAndDefendant(caseInfo.caseNo, caseInfo.defendant);
    const id = activeCase ? activeCase.id : makePaperId(caseInfo.caseNo, caseInfo.defendant);

    // Save the actual PDF to storage, attached to this case -- viewable
    // later from Search Cases, right alongside the intake.
    let returnPdfPath = null;
    try {
      returnPdfPath = await uploadReturnPdf(id, Buffer.from(returnPdfBase64, 'base64'));
    } catch (storageErr) {
      console.error('Failed to store return PDF:', storageErr);
      return { statusCode: 500, body: 'Failed to store the PDF: ' + storageErr.message };
    }

    // Update the case record. We track papers, not just cases -- a
    // multi-defendant case only closes once every defendant is served;
    // this return marks just the defendant(s) it covers.
    const existing = activeCase || (await getCase(id));
    if (existing) {
      const coveredNames = Array.isArray(servedDefendants) && servedDefendants.length
        ? servedDefendants
        : [existing.defendant].filter(Boolean);

      if (Array.isArray(existing.defendants)) {
        existing.defendants = existing.defendants.map((d) =>
          coveredNames.includes(d.name)
            ? { ...d, served: true, returnDate: effectiveReturnDate, returnPdfPath }
            : d
        );
      }

      existing.returns = Array.isArray(existing.returns) ? existing.returns : [];
      existing.returns.push({ defendants: coveredNames, date: effectiveReturnDate, pdfPath: returnPdfPath, outcome: returnOutcome || 'Served' });

      existing.returnSent = true; // kept for anything still reading this flag at the case level
      existing.returnDate = effectiveReturnDate;
      existing.returnPdfPath = returnPdfPath;
      // Drives the status label shown everywhere -- "Served" / "Return
      // Not Found" / "Return Requested per Plaintiff" instead of a bare
      // "Closed", so the outcome is visible at a glance.
      existing.returnOutcome = returnOutcome || 'Served';

      // Only close the case once every defendant on it has actually been
      // served. Affidavit-tracked cases (alias + Scott Weiss) stay
      // governed by the affidavit completion event regardless.
      const allServed =
        !Array.isArray(existing.defendants) ||
        existing.defendants.length === 0 ||
        existing.defendants.every((d) => d.served);
      if (!existing.needsAffidavitTracking && allServed) {
        existing.status = 'closed';
        existing.closedDate = new Date().toISOString();
      }

      await putCase(existing);
    }

    return { statusCode: 200, body: JSON.stringify({ attached: true, returnPdfPath }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to attach return' };
  }
};
