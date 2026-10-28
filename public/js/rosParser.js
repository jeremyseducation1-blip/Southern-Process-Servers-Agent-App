// Reads the text of a scanned Davidson County "RETURN OF SERVICE" form
// (as produced by OCR) into intake fields. Pure text in, plain object out,
// so it can be tested without a browser. Everything it returns is a
// suggestion the person reviews before saving.
(function (root) {
  const KEEP_UPPER = new Set(['PC', 'LLC', 'LLP', 'LP', 'PLLC', 'PA', 'HOA', 'INC', 'II', 'III', 'IV', 'TN', 'USA', 'NA', 'DBA', 'MD', 'DDS', 'OB', 'GYN']);
  const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
  const UNIT_WORDS = new Set(['APT', 'UNIT', 'STE', 'SUITE', 'LOT', 'BLDG', '#', 'NO']);

  function titleWord(w) {
    if (KEEP_UPPER.has(w)) return w;
    if (/^\d+(ST|ND|RD|TH)$/.test(w)) return w.toLowerCase();
    if (DIRECTIONS.has(w)) return w;
    if (/^[A-Z]$/.test(w)) return w;
    return w.replace(/[A-Za-z]+/g, (p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      // Mc/Mac-style and O'Brien-style capitals
      .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase())
      .replace(/\bO'([a-z])/g, (m, c) => "O'" + c.toUpperCase());
  }
  function titleCase(s) {
    return String(s || '').trim().split(/\s+/).map(titleWord).join(' ');
  }

  // "26GC21432". OCR often reads the G as 6 and the C as 0 ("266021432").
  function normalizeDocket(raw) {
    const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let m = /^(\d{2})(GC)(\d{3,6})$/.exec(s);
    if (m) return { value: m[1] + m[2] + m[3], sure: true };
    m = /^(\d{2})([6G][0CO])(\d{4,6})$/.exec(s);
    if (m) return { value: m[1] + 'GC' + m[3], sure: false };
    m = /^(\d{2})([A-Z]{1,3})(\d{3,6})$/.exec(s); // some other court's format: keep, but flag
    if (m) return { value: s, sure: false };
    return null;
  }

  function findDocket(text) {
    const near = /DOCKET\s*N[O0]\.?[\s,:;]*([A-Z0-9\- ]{7,13})/i.exec(text);
    if (near) {
      const n = normalizeDocket(near[1].split(/\s{2,}|\n/)[0]) || normalizeDocket(near[1].replace(/\s/g, ''));
      if (n) return n;
    }
    // Header words sometimes get lost under a handwritten mark; the number itself usually survives.
    const loose = /\b(\d{2}\s?G[C]\s?\d{4,6})\b/.exec(text.toUpperCase());
    if (loose) return normalizeDocket(loose[1]);
    return null;
  }

  function cleanStreet(raw) {
    let t = raw.trim().split(/\s+/);
    // Stray 1-2 digit speck in front of the real house number ("14 4981 LEESA ...").
    while (t.length > 2 && /^\d{1,2}$/.test(t[0]) && /^\d+$/.test(t[1])) t.shift();
    // Trailing speck: a lone letter that isn't a direction, or a lone digit that isn't a unit number.
    for (;;) {
      const last = t[t.length - 1], prev = t[t.length - 2];
      if (t.length > 2 && /^[A-Z]$/.test(last) && !DIRECTIONS.has(last)) { t.pop(); continue; }
      if (t.length > 2 && /^\d$/.test(last) && !(prev && (UNIT_WORDS.has(prev) || prev === '#'))) { t.pop(); continue; }
      break;
    }
    return t.join(' ');
  }

  function parsePage(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = { docket: null, docketSure: false, plaintiff: '', defendant: '', serviceAddress: '', phone: '', county: '', courtType: '', warnings: [] };

    const d = findDocket(String(text || ''));
    if (d) { out.docket = d.value; out.docketSure = d.sure; }

    // Plaintiff "vs." caption (also used to cross-check the defendant)
    let caption = '';
    for (const l of lines) {
      const m = /^[^A-Za-z0-9]*([A-Z][A-Z0-9 &.,'\-]{4,}?)\s+(?:vs\.?|v\.|ys|vs)\s+([A-Z][A-Z0-9 .,'\-]+)/.exec(l);
      if (m) { out.plaintiff = titleCase(m[1]); caption = m[2].trim(); break; }
    }

    // The person being served: the "Executed and/or Served on NAME in the following manner" line is the cleanest.
    let name = '';
    for (const l of lines) {
      const m = /Served\s+on\s+([A-Z][A-Z .'\-]+?)\s+in\s+the\s+following/i.exec(l);
      if (m) { name = m[1].trim(); break; }
    }
    let toIdx = -1;
    lines.forEach((l, i) => { if (toIdx < 0 && /(?:^|\s)To:\s*/.test(l)) toIdx = i; });
    if (toIdx >= 0) {
      const after = lines[toIdx].replace(/^.*?To:\s*[|©\-:\s]*/, '');
      const words = [];
      for (const w of after.split(/\s+/)) { if (/^[A-Z][A-Z.'\-]*$/.test(w)) words.push(w); else break; }
      const toName = words.join(' ');
      if (!name || (toName && toName.startsWith(name.split(' ')[0]) && toName.length < name.length + 3)) name = name || toName;
    }
    if (!name && caption) name = caption;
    out.defendant = titleCase(name);

    // Address: street line + "CITY, ST 12345" line after the To: line
    const scan = lines.slice(toIdx >= 0 ? toIdx : 0, (toIdx >= 0 ? toIdx : 0) + 7);
    let street = '', cityLine = '';
    for (const l of scan) {
      if (!street) {
        const m = /(\d{1,6}[A-Z]?\s+(?:[A-Z0-9.'#\-]+(?=\s|$)\s*)+)/.exec(l.replace(/^[^A-Z0-9]+/, ''));
        if (m && /[A-Z]{2}/.test(m[1])) { street = cleanStreet(m[1]); continue; }
      }
      const c = /([A-Z][A-Z .'\-]+),\s*([A-Z]{2})\s+(\d{5})/.exec(l);
      if (c) { cityLine = `${titleCase(c[1])}, ${c[2]} ${c[3]}`; if (!out.county) { /* county below */ } break; }
    }
    if (street) out.serviceAddress = titleCase(street) + (cityLine ? ', ' + cityLine : '');

    const ph = /Phone[^\n]*?\(?(\d{3})\)?[\s.\-]*(\d{3})[\s.\-]*(\d{4})/i.exec(String(text || ''));
    if (ph) out.phone = `(${ph[1]}) ${ph[2]}-${ph[3]}`;

    const cty = /\b([A-Z]{3,})\s+COUNTY\b/.exec(String(text || '').toUpperCase());
    if (cty) out.county = titleCase(cty[1]);
    if (out.docket && /^\d{2}GC/.test(out.docket)) out.courtType = 'General Sessions';

    if (!out.docket) out.warnings.push('Could not read the docket number — type it in.');
    else if (!out.docketSure) out.warnings.push('Check the docket number.');
    if (!out.plaintiff) out.warnings.push('Plaintiff not read.');
    if (!out.defendant) out.warnings.push('Defendant not read.');
    if (!out.serviceAddress) out.warnings.push('Address not read.');
    return out;
  }

  const api = { parsePage, normalizeDocket, findDocket, titleCase, cleanStreet };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ROSParser = api;
})(typeof window !== 'undefined' ? window : this);
