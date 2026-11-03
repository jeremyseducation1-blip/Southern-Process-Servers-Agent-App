require('./lib/ensureWebSocket');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { requireAuth } = require('./lib/auth');
const { sendGmail } = require('./lib/sendGmail');
const { getCase, putCase, getSupabaseClient } = require('./lib/caseStore');
const { uploadReturnPdf } = require('./lib/returnStorage');

const KEVIN_EMAIL = process.env.KEVIN_EMAIL || 'kevin@example.com';

function attorneyLastName(attorney) {
  const parts = (attorney || '').trim().split(/\s+/);
  return parts[parts.length - 1] || '';
}
// Same subject rule as the original send: "<defendants> / <attorney last name>"
function buildSubject(c) {
  const names = Array.isArray(c.defendants) && c.defendants.length
    ? c.defendants.map((d) => d.name).filter(Boolean)
    : [c.defendant].filter(Boolean);
  const last = attorneyLastName(c.attorney);
  return `${names.join(', ')}${last ? ' / ' + last : ''}`;
}

async function downloadStoredReturn(path) {
  const sb = getSupabaseClient();
  const { data, error } = await sb.storage.from('returns').download(path);
  if (error) throw new Error(error.message);
  return Buffer.from(await data.arrayBuffer());
}

// Writes text onto a page. x/y are fractions of the page from the top-left.
async function stampText(pdfBuffer, { text, x, y, page, size }) {
  const doc = await PDFDocument.load(pdfBuffer);
  const pages = doc.getPages();
  const pg = pages[Math.min(Math.max(Number(page) || 0, 0), pages.length - 1)];
  const { width, height } = pg.getSize();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const fs = Math.max(6, Math.min(40, (Number(size) || 0.024) * width));
  const clean = String(text || '').replace(/[^\x20-\x7E]/g, '').slice(0, 80);
  if (!clean) throw new Error('Type the text to add first.');
  pg.drawText(clean, {
    x: Math.min(Math.max(Number(x) || 0, 0), 1) * width,
    y: height - Math.min(Math.max(Number(y) || 0, 0), 1) * height - fs, // tap point = top-left of the text
    size: fs,
    font,
    color: rgb(0.05, 0.12, 0.45)
  });
  return Buffer.from(await doc.save());
}

// Replaces the return PDF on an ALREADY-returned case (a new scan, or text
// added to the stored one) and emails the corrected copy to Kevin. It does
// not touch the return date, outcome, billing week, or open/closed status.
// POST {id, returnPdfBase64?, stamp?: {text,x,y,page,size}}
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { id, returnPdfBase64, stamp } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };

    const existing = await getCase(id);
    if (!existing) return { statusCode: 404, body: 'No case found with that id.' };
    if (!existing.returnSent && !existing.returnPdfPath) return { statusCode: 400, body: 'This case has no return on file yet.' };

    let pdf;
    if (returnPdfBase64) {
      pdf = Buffer.from(returnPdfBase64, 'base64');
    } else if (stamp && existing.returnPdfPath) {
      pdf = await stampText(await downloadStoredReturn(existing.returnPdfPath), stamp);
    } else {
      return { statusCode: 400, body: 'Pick a new PDF, or add text to the stored one.' };
    }
    if (pdf.slice(0, 4).toString() !== '%PDF') return { statusCode: 400, body: 'That file is not a PDF.' };

    // Email first (like the original send), so nothing changes if it fails.
    try {
      await sendGmail({
        to: KEVIN_EMAIL,
        subject: buildSubject(existing),
        text:
          `CORRECTED return attached for ${existing.caseNo || 'this case'} — please use this one instead of the earlier copy.\n\n` +
          `Outcome: ${existing.returnOutcome || 'Served'}\n` +
          `Return date: ${existing.returnDate || ''}\n` +
          (existing.returnNotes ? `\nNotes:\n${existing.returnNotes}\n` : ''),
        attachments: [{
          filename: `return-${(existing.caseNo || 'case').replace(/[^a-z0-9_-]/gi, '_')}.pdf`,
          mimeType: 'application/pdf',
          base64: pdf.toString('base64')
        }]
      });
    } catch (mailErr) {
      console.error('Gmail send failed:', mailErr);
      return { statusCode: 502, body: 'EMAIL_FAILED: ' + (mailErr.message || 'Gmail send failed') };
    }

    let path = existing.returnPdfPath;
    try {
      path = await uploadReturnPdf(id, pdf); // same path, replaces the old file
    } catch (storageErr) {
      console.error('Failed to store corrected PDF (email already sent):', storageErr);
    }
    existing.returnPdfPath = path || existing.returnPdfPath;
    existing.returnResentAt = new Date().toISOString();
    if (Array.isArray(existing.returns) && existing.returns.length) {
      const last = existing.returns[existing.returns.length - 1];
      last.pdfPath = existing.returnPdfPath;
      last.resentAt = existing.returnResentAt;
    }
    await putCase(existing);
    return { statusCode: 200, body: JSON.stringify({ resent: true, case: existing }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to resend return' };
  }
});
