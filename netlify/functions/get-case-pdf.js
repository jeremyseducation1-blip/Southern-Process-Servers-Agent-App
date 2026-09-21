const { getCase } = require('./lib/caseStore');
const { getReturnPdfUrl, getAffidavitPdfUrl } = require('./lib/returnStorage');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    // `id` is the paper's unique row id (case numbers repeat, so aren't
    // enough on their own to identify one specific paper).
    const id = event.queryStringParameters?.id;
    const kind = event.queryStringParameters?.kind === 'affidavit' ? 'affidavit' : 'return';
    if (!id) return { statusCode: 400, body: 'id is required.' };

    const caseRecord = await getCase(id);
    if (!caseRecord) return { statusCode: 404, body: 'No case found with that id.' };

    const path = kind === 'affidavit' ? caseRecord.affidavitPdfPath : caseRecord.returnPdfPath;
    if (!path) {
      return { statusCode: 404, body: `No ${kind} PDF on file for this case.` };
    }

    const url = kind === 'affidavit' ? await getAffidavitPdfUrl(path) : await getReturnPdfUrl(path);

    return { statusCode: 200, body: JSON.stringify({ url }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to get PDF' };
  }
};
