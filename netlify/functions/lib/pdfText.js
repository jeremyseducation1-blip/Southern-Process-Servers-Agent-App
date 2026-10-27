// Word-wrap helper for the PDFs. Splits text into lines no wider than
// maxWidth (points) for the given pdf-lib font/size. A single word wider
// than a whole line is broken mid-word, so text can never run off the page
// or collide with the column next to it.
function wrapLines(text, font, size, maxWidth) {
  const lines = [];
  let line = '';
  const push = (word) => {
    const trial = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) { line = trial; return; }
    if (line) { lines.push(line); line = ''; }
    if (font.widthOfTextAtSize(word, size) <= maxWidth) { line = word; return; }
    let chunk = '';
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) { lines.push(chunk); chunk = ch; } else chunk += ch;
    }
    line = chunk;
  };
  String(text).split(/\s+/).filter(Boolean).forEach(push);
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

module.exports = { wrapLines };
