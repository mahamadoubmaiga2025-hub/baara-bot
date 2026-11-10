// Générateur PDF minimaliste en pur Node (aucune dépendance) — A4, Helvetica/Helvetica-Bold, WinAnsi (accents FR OK).
// Suffisant pour des documents texte propres : titres, paragraphes enveloppés, filets de séparation, multi-pages.

const CHAR_W = 0.50; // largeur moyenne d'un caractère, en fraction de la taille (Helvetica)

function sanitize(str) {
  const map = { "\u2019": "\u0092", "\u2018": "\u0091", "\u201C": "\u0093", "\u201D": "\u0094", "\u2026": "\u0085", "\u2013": "\u0096", "\u2014": "\u0097", "\u20AC": "\u0080", "\u2022": "\u0095" };
  let out = "";
  for (const ch of String(str == null ? "" : str)) {
    if (map[ch] !== undefined) out += map[ch];
    else { const c = ch.codePointAt(0); out += (c >= 32 && c <= 255) ? ch : " "; }
  }
  return out;
}
const esc = (t) => sanitize(t).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function wrap(text, size, maxWidth, bold) {
  const maxChars = Math.max(8, Math.floor(maxWidth / (size * (bold ? 0.54 : CHAR_W))));
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
    while (cur.length > maxChars) { lines.push(cur.slice(0, maxChars)); cur = cur.slice(maxChars); }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// blocks : [{ text, size?, bold?, spaceBefore?, color?: [r,g,b], align?: "left"|"center" } | { rule: true, spaceBefore? }]
function createPdf(blocks, opts) {
  const W = 595, H = 842, M = (opts && opts.margin) || 48;
  const maxW = W - 2 * M;
  const pages = []; let stream = ""; let y = H - M;
  const newPage = () => { pages.push(stream); stream = ""; y = H - M; };
  const need = (h) => { if (y - h < M) newPage(); };
  for (const b of blocks) {
    if (b.band) {
      const lines = b.band.lines || [];
      const lh = lines.reduce((a, l) => a + (l.size || 12) * 1.32, 0);
      const bh = lh + 36;
      const top = y + M;
      const c = b.band.color || [0.05, 0.22, 0.15];
      stream += `${c[0]} ${c[1]} ${c[2]} rg 0 ${(top - bh).toFixed(1)} ${W} ${bh.toFixed(1)} re f\n`;
      if (b.band.strip) { const sc = b.band.strip; stream += `${sc[0]} ${sc[1]} ${sc[2]} rg 0 ${(top - bh - 4).toFixed(1)} ${W} 4 re f\n`; }
      let ly = top - 32;
      for (const l of lines) {
        const col = l.color || [1, 1, 1];
        stream += `BT ${col[0]} ${col[1]} ${col[2]} rg /F${l.bold ? 2 : 1} ${l.size || 12} Tf ${M} ${ly.toFixed(1)} Td (${esc(l.text || "")}) Tj ET\n`;
        ly -= (l.size || 12) * 1.32;
      }
      y = top - bh - 22;
      continue;
    }
    if (b.rule) { need(14); y -= (b.spaceBefore || 6); const rc = b.ruleColor || [0.75, 0.75, 0.75]; const rw = b.ruleWidth || 0.5; stream += `${rc[0]} ${rc[1]} ${rc[2]} RG ${rw.toFixed(1)} w ${M} ${y.toFixed(1)} m ${W - M} ${y.toFixed(1)} l S 0 g\n`; y -= 14; continue; }
    const size = b.size || 11, bold = !!b.bold, lh = size * 1.38;
    if (b.keepNext) need((b.spaceBefore || 0) + lh + b.keepNext); // garde le bloc avec la suite (titre de section jamais seul en bas de page)
    y -= (b.spaceBefore || 0);
    const lines = wrap(b.text || "", size, maxW, bold);
    for (const line of lines) {
      need(lh);
      const col = b.color ? `${b.color[0]} ${b.color[1]} ${b.color[2]} rg ` : "0 g ";
      const approxW = line.length * size * (bold ? 0.54 : CHAR_W);
      const x = b.align === "center" ? Math.max(M, (W - approxW) / 2) : M;
      stream += `BT ${col}/F${bold ? 2 : 1} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(line)}) Tj ET\n`;
      y -= lh;
    }
  }
  pages.push(stream);
  if (opts && typeof opts.footer === "function") {
    for (let i = 0; i < pages.length; i++) {
      const ft = sanitize(opts.footer(i + 1, pages.length));
      const fx = Math.max(M, (W - ft.length * 8 * 0.5) / 2);
      pages[i] += `BT 0.55 g /F1 8 Tf ${fx.toFixed(1)} 26 Td (${esc(ft)}) Tj ET\n`;
    }
  }

  // Assemblage des objets PDF (offsets calculés en octets latin1)
  const enc = (str) => Buffer.from(str, "latin1");
  const objects = []; // {num, body:Buffer}
  const fontReg = 3, fontBold = 4;
  const pageNums = pages.map((_, i) => 5 + i * 2);
  objects.push({ num: 1, body: enc("<< /Type /Catalog /Pages 2 0 R >>") });
  objects.push({ num: 2, body: enc(`<< /Type /Pages /Kids [${pageNums.map(n => n + " 0 R").join(" ")}] /Count ${pages.length} >>`) });
  objects.push({ num: fontReg, body: enc("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>") });
  objects.push({ num: fontBold, body: enc("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>") });
  pages.forEach((content, i) => {
    const contentNum = 6 + i * 2;
    objects.push({ num: 5 + i * 2, body: enc(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentNum} 0 R >>`) });
    const cb = enc(content);
    objects.push({ num: contentNum, body: Buffer.concat([enc(`<< /Length ${cb.length} >>\nstream\n`), cb, enc("\nendstream")]) });
  });
  objects.sort((a, b) => a.num - b.num);
  let out = enc("%PDF-1.4\n"); const offsets = {};
  for (const o of objects) { offsets[o.num] = out.length; out = Buffer.concat([out, enc(`${o.num} 0 obj\n`), o.body, enc("\nendobj\n")]); }
  const xrefPos = out.length; const maxNum = Math.max(...objects.map(o => o.num));
  let xref = `xref\n0 ${maxNum + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxNum; n++) xref += String(offsets[n] || 0).padStart(10, "0") + " 00000 n \n";
  out = Buffer.concat([out, enc(xref + `trailer\n<< /Size ${maxNum + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`)]);
  return out;
}

module.exports = { createPdf, sanitize };
