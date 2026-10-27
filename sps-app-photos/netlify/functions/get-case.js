const { getCasesByCaseNo, getActivePaperByCaseAndDefendant } = require('./lib/caseStore');

// Case numbers repeat, so this looks up one specific paper by case number
// + defendant when both are given (used by the Return section, which
// always has a specific defendant in mind). With just a case number, it
// returns the first matching row -- good enough for the "does this case
// exist yet" convenience check the Return section also uses.
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const caseNo = event.queryStringParameters?.caseNo;
    const defendant = event.queryStringParameters?.defendant;
    if (!caseNo) return { statusCode: 400, body: 'caseNo is required.' };

    let caseRecord;
    if (defendant) {
      caseRecord = await getActivePaperByCaseAndDefendant(caseNo, defendant);
    } else {
      const matches = await getCasesByCaseNo(caseNo);
      caseRecord = matches[0] || null;
    }
    if (!caseRecord) return { statusCode: 404, body: 'No case found with that case number.' };

    return { statusCode: 200, body: JSON.stringify({ case: caseRecord }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to load case' };
  }
};
