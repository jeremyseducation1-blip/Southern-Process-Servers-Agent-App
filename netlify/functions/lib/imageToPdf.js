// Wraps one or more photographed images (a return document, now possibly
// multiple pages) into a PDF, one page per image, each sized to fit the
// page while keeping its aspect ratio.
const { PDFDocument } = require('pdf-lib');

// Buffer.from(base64, 'base64') can return a view into Node's shared
// memory pool with a non-zero byteOffset. pdf-lib's JPEG reader builds a
// DataView straight off `.buffer` and assumes it starts at byte 0, so a
// pooled buffer gets misread ("SOI not found in JPEG") even though the
// bytes themselves are a perfectly valid image. Copying into a fresh,
// standalone Uint8Array guarantees byteOffset 0.
function toCleanBytes(base64Data) {
  return Uint8Array.from(Buffer.from(base64Data, 'base64'));
}

// pages: array of { base64, mimeType } in the order they should appear.
async function imagesToPdf(pages) {
  const doc = await PDFDocument.create();

  for (const { base64, mimeType } of pages) {
    const bytes = toCleanBytes(base64);
    let image;
    if (mimeType === 'image/png') {
      image = await doc.embedPng(bytes);
    } else {
      // Treat anything else (jpg/jpeg/heic-converted-to-jpeg, etc.) as JPEG.
      image = await doc.embedJpg(bytes);
    }

    const page = doc.addPage([612, 792]); // letter
    const maxWidth = 612 - 72; // 36pt margin each side
    const maxHeight = 792 - 72;

    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;

    page.drawImage(image, {
      x: (612 - w) / 2,
      y: (792 - h) / 2,
      width: w,
      height: h
    });
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

// Kept for anything that only ever has a single image -- same signature
// as before, just implemented on top of imagesToPdf now.
async function imageToPdf(base64Data, mimeType) {
  return imagesToPdf([{ base64: base64Data, mimeType }]);
}

module.exports = { imageToPdf, imagesToPdf };
