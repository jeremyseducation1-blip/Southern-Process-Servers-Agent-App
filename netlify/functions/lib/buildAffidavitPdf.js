// Builds the Affidavit of Non-Service PDF as a Buffer, matching the exact
// paper template Jeremy files with the court: same caption/bracket layout,
// same boilerplate wording, same checkbox block, and the red server-info
// block next to the signature. Uses pdf-lib (pure JS, runs fine in a
// Netlify Function).
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const ORDINALS = { 1: 'First', 2: 'Second', 3: 'Third' };

const CLOSING_STATEMENT = {
  'No response': 'It is my knowledge and belief that the Defendant has not responded to service of process.',
  'Evading service': 'It is my knowledge and belief that the Defendant is evading service of process.',
  'Vacant home': 'It is my knowledge and belief that the address provided is a vacant property.',
  'Bad address': 'It is my knowledge and belief that the address provided is not a valid address for the Defendant.'
};

// Splits "3013 Delta Queen Dr, Nashville, TN 37214" into a street line and
// a city/state/zip line, the way the paper form shows it on two lines.
function splitAddress(address) {
  const idx = address.indexOf(',');
  if (idx === -1) return [address, ''];
  return [address.slice(0, idx).trim(), address.slice(idx + 1).trim()];
}

function wrapText(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function buildAffidavitPdf({ caseInfo, attempts, status, signatureDataUrl, serverInfo }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // letter
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);

  const left = 72;
  const right = 540;
  const pageWidth = right - left;
  let y = 730;

  function text(str, x, size, useFont, color) {
    page.drawText(str, { x, y, size, font: useFont, color: color || rgb(0, 0, 0) });
  }
  function centered(str, size, useFont) {
    const w = useFont.widthOfTextAtSize(str, size);
    text(str, left + (pageWidth - w) / 2, size, useFont);
  }
  function underline(x, w, yy) {
    page.drawLine({ start: { x, y: (yy ?? y) - 2 }, end: { x: x + w, y: (yy ?? y) - 2 }, thickness: 0.75, color: rgb(0, 0, 0) });
  }
  function hr(yy) {
    page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness: 1, color: rgb(0, 0, 0) });
  }

  const state = caseInfo.state || 'Tennessee';
  const county = caseInfo.county || '';
  const courtType = caseInfo.courtType || '';

  // ---- Caption header ----
  centered(`IN THE ${courtType} COURT OF ${county} COUNTY, ${state.toUpperCase()}`, 12, bold);
  y -= 22;

  // ---- Party caption block with bracket ----
  const captionTop = y;
  const plaintiffName = caseInfo.plaintiff || '';
  const defendantName = caseInfo.defendant || '';
  const nameIndent = left + 90;

  // Plaintiff name (underlined) + "Plaintiff,"
  text(plaintiffName, nameIndent, 11, font);
  underline(nameIndent - 10, 260, y);
  y -= 18;
  text('Plaintiff,', left + 70, 11, font);
  y -= 18;

  // "v." sits lower, flush left
  text('v.', left, 11, font);
  y -= 18;

  // Defendant name (underlined) + "Defendant."
  text(defendantName, nameIndent, 11, font);
  underline(nameIndent - 10, 260, y);
  y -= 18;
  text('Defendant.', left + 70, 11, font);

  // Bracket -- a ")" on each of the five caption lines, plus the case
  // number vertically centered against it, same as the paper form.
  const bracketX = 470;
  for (let i = 0; i < 5; i++) {
    page.drawText(')', { x: bracketX, y: captionTop - i * 18, size: 12, font });
  }
  page.drawText(`Case No: ${caseInfo.caseNo || ''}`, {
    x: bracketX + 25,
    y: captionTop - 2 * 18,
    size: 12,
    font: bold
  });

  y -= 18;
  hr(y);
  y -= 14;
  centered('AFFIDAVIT OF NON-SERVICE', 13, bold);
  y -= 8;
  hr(y);
  y -= 20;

  // ---- State/County recital ----
  text(`STATE OF ${state}`, left, 11, font);
  text(')', left + 140, 11, font);
  y -= 18;
  text(`COUNTY OF ${county}`, left, 11, font);
  text(')', left + 140, 11, font);
  y -= 26;

  // ---- Numbered paragraphs (wrapped to full width) ----
  const serverName = serverInfo?.name || '';
  const para1 =
    `1. I, ${serverName}, am a process server and I am more than eighteen years of age and I am ` +
    `competent to testify to the matters set forth herein. All statements set forth herein are of my ` +
    `own personal knowledge, except as noted, and are true and correct.`;
  wrapText(para1, font, 11, pageWidth).forEach((ln) => {
    text(ln, left, 11, font);
    y -= 16;
  });
  y -= 4;

  const para2 =
    `2. The Plaintiff in the referenced matter has designated me to serve the Defendant by private ` +
    `process. The following occurred for the service of process:`;
  wrapText(para2, font, 11, pageWidth).forEach((ln) => {
    text(ln, left, 11, font);
    y -= 16;
  });
  y -= 14;

  // ---- Defendant / address / attempts two-column block ----
  const labelX = left;
  const valueX = left + 210;
  const valueWidth = right - valueX;

  text('Defendant:', labelX, 11, font);
  text(defendantName, valueX, 11, font);
  y -= 18;

  text('Location/Address of Service:', labelX, 11, font);
  const [street, cityStateZip] = splitAddress(caseInfo.serviceAddress || '');
  text(street, valueX, 11, font);
  y -= 15;
  text(cityStateZip, valueX, 11, font);
  y -= 20;

  // Checkboxes (left column) alongside attempt narratives (right column),
  // top-aligned together the way the paper form lays them out.
  const checkboxTopY = y;
  text('Dates attempted service:', labelX, 11, font);

  const checkboxLabels = ['No response', 'Evading service', 'Vacant home', 'Bad address'];
  let checkY = checkboxTopY - 20;
  checkboxLabels.forEach((label) => {
    const boxSize = 9;
    page.drawRectangle({
      x: labelX + 8,
      y: checkY - boxSize + 2,
      width: boxSize,
      height: boxSize,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1
    });
    if (status === label) {
      page.drawLine({
        start: { x: labelX + 8, y: checkY - boxSize + 2 },
        end: { x: labelX + 8 + boxSize, y: checkY + 2 },
        thickness: 1,
        color: rgb(0, 0, 0)
      });
      page.drawLine({
        start: { x: labelX + 8, y: checkY + 2 },
        end: { x: labelX + 8 + boxSize, y: checkY - boxSize + 2 },
        thickness: 1,
        color: rgb(0, 0, 0)
      });
    }
    page.drawText(label, { x: labelX + 22, y: checkY - 7, size: 10, font });
    checkY -= 18;
  });
  // Attempt narratives on the right, one paragraph per attempt, wrapped.
  let attemptY = checkboxTopY - 20;
  attempts.forEach((a) => {
    const ordinal = ORDINALS[a.n] || `${a.n}th`;
    const noteText = (a.note || '').trim() || 'A notice was left and photographed as evidence of this attempt.';
    const sentence = `${ordinal} attempt was made on ${a.date}. ${noteText}`.trim();
    const lines = wrapText(sentence, font, 11, valueWidth);
    lines.forEach((ln) => {
      page.drawText(ln, { x: valueX, y: attemptY, size: 11, font });
      attemptY -= 15;
    });
    attemptY -= 8;
  });

  y = Math.min(checkY, attemptY) - 14;

  // ---- Closing statement ----
  const closing = CLOSING_STATEMENT[status] || CLOSING_STATEMENT['No response'];
  wrapText(closing, font, 11, pageWidth).forEach((ln) => {
    text(ln, left, 11, font);
    y -= 16;
  });
  y -= 20;

  // ---- Signature + red server-info block ----
  const sigLineY = y - 28;
  if (signatureDataUrl) {
    const base64 = signatureDataUrl.split(',')[1];
    const sigBytes = Uint8Array.from(Buffer.from(base64, 'base64'));
    const sigImage = await doc.embedPng(sigBytes);
    const sigDims = sigImage.scale(0.35);
    page.drawImage(sigImage, {
      x: left,
      y: sigLineY + 4,
      width: sigDims.width,
      height: sigDims.height
    });
  }
  page.drawLine({ start: { x: left, y: sigLineY }, end: { x: left + 260, y: sigLineY }, thickness: 1, color: rgb(0, 0, 0) });
  page.drawText('Server', { x: left, y: sigLineY - 16, size: 10, font });

  // Red server-info block, top-aligned near the signature.
  const redX = left + 300;
  let redY = y + 10;
  const red = rgb(0.75, 0.05, 0.05);
  [serverInfo?.name, serverInfo?.box, serverInfo?.cityState, serverInfo?.phone]
    .filter(Boolean)
    .forEach((line) => {
      page.drawText(line, { x: redX, y: redY, size: 10, font: bold, color: red });
      redY -= 14;
    });

  y = sigLineY - 34;

  // ---- Notary block ----
  text('Sworn to and subscribed before me on this', left, 11, font);
  const swornWidth = font.widthOfTextAtSize('Sworn to and subscribed before me on this', 11);
  underline(left + swornWidth + 6, 60, y);
  text('.', left + swornWidth + 72, 11, font);
  y -= 30;

  underline(left, 260, y);
  y -= 14;
  text('NOTARY PUBLIC', left, 11, font);
  y -= 18;
  text('MY COMMISSION EXPIRES:', left, 11, font);
  underline(left + 150, 200, y);

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { buildAffidavitPdf };
