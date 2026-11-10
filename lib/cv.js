// Construction du CV PDF — design professionnel : bandeau vert encre + liseré ocre (identité FasoTech),
// sections accentuées, puces, pied de page paginé. Même structure que les modèles RealFreeCV.
const { createPdf } = require("./pdf");

const INK = [0.13, 0.15, 0.17], ACCENT = [0.85, 0.55, 0.10], GREY = [0.35, 0.38, 0.42];
const BAND = [0.05, 0.22, 0.15], BAND_GOLD = [0.98, 0.78, 0.40], BAND_SUB = [0.88, 0.90, 0.92];

// data : { name, title, contact, city, summary, experiences: [{head, body}] | expRaw, formations: [str] | eduRaw, skills: [str] | skillsRaw, languages: [str] | langRaw }
function section(blocks, title) {
  blocks.push({ text: title, size: 12.5, bold: true, color: ACCENT, spaceBefore: 15, keepNext: 31 }); // titre + filet + 1re ligne de contenu restent ensemble
  blocks.push({ rule: true, spaceBefore: 2 });
}
function buildCvPdf(data) {
  const b = [];
  const name = (data.name || "Sans nom").toUpperCase().slice(0, 34);
  const nameSize = name.length > 24 ? 19 : 23;
  const contactLine = [data.contact, data.city].filter(Boolean).join("   ·   ");
  const bandLines = [{ text: name, size: nameSize, bold: true, color: [1, 1, 1] }];
  if (data.title) bandLines.push({ text: data.title, size: 13, color: BAND_GOLD });
  if (contactLine) bandLines.push({ text: contactLine, size: 9.8, color: BAND_SUB });
  b.push({ band: { color: BAND, strip: ACCENT, lines: bandLines } });

  if (data.summary) { section(b, "PROFIL"); b.push({ text: data.summary, size: 10.8, color: INK }); }

  const exps = Array.isArray(data.experiences) ? data.experiences : [];
  if (exps.length || data.expRaw) {
    section(b, "EXPÉRIENCES");
    if (exps.length) for (const e of exps) {
      if (e.head) b.push({ text: e.head, size: 11, bold: true, color: INK, spaceBefore: 7, keepNext: 15 }); // l'intitulé reste avec son descriptif
      if (e.body) b.push({ text: e.body, size: 10.8 });
    } else b.push({ text: data.expRaw, size: 10.8 });
  }

  const forms = Array.isArray(data.formations) ? data.formations : [];
  if (forms.length || data.eduRaw) {
    section(b, "FORMATION");
    if (forms.length) for (const f of forms) b.push({ text: "•  " + f, size: 10.8, spaceBefore: 2 });
    else b.push({ text: data.eduRaw, size: 10.8 });
  }

  const skills = Array.isArray(data.skills) ? data.skills : (data.skillsRaw ? data.skillsRaw.split(",").map(x => x.trim()).filter(Boolean) : []);
  if (skills.length) { section(b, "COMPÉTENCES"); b.push({ text: skills.join("   •   "), size: 10.8 }); }

  const langs = Array.isArray(data.languages) ? data.languages : (data.langRaw ? data.langRaw.split(",").map(x => x.trim()).filter(Boolean) : []);
  if (langs.length) { section(b, "LANGUES"); b.push({ text: langs.join("   •   "), size: 10.8 }); }

  const footerName = (data.name || "CV").slice(0, 30);
  return createPdf(b, { footer: (i, n) => `${footerName} — CV · Page ${i}/${n} · Baara × RealFreeCV (realfreecv.cv)` });
}

module.exports = { buildCvPdf };
