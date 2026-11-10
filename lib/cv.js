// Construction du CV PDF — 4 modèles professionnels au choix.
// data : { name, title, contact, city, summary, experiences: [{head, body}] | expRaw, formations: [str] | eduRaw, skills: [str] | skillsRaw, languages: [str] | langRaw }
const { createPdf } = require("./pdf");

const INK = [0.13, 0.15, 0.17], GREY = [0.35, 0.38, 0.42];

const TEMPLATES = {
  encre: {
    label: "🌿 Classique Encre",
    desc: "Bandeau vert profond, accents dorés — sérieux et institutionnel (ONG, administration).",
    band: [0.05, 0.22, 0.15], strip: [0.85, 0.55, 0.10], bandTitle: [0.98, 0.78, 0.40], bandSub: [0.88, 0.90, 0.92],
    heading: [0.85, 0.55, 0.10], rule: [0.85, 0.55, 0.10], ruleWidth: 1.1,
  },
  nuit: {
    label: "🌌 Moderne Nuit",
    desc: "Bandeau bleu nuit, accents azur — tech, digital, secteur privé moderne.",
    band: [0.05, 0.14, 0.27], strip: [0.30, 0.68, 0.95], bandTitle: [0.62, 0.83, 0.97], bandSub: [0.85, 0.89, 0.94],
    heading: [0.07, 0.25, 0.45], rule: [0.30, 0.68, 0.95], ruleWidth: 1.1,
  },
  bogolan: {
    label: "🟫 Signature Bogolan",
    desc: "Bandeau brun-noir profond, ocre bogolan — identité malienne, entrepreneuriat, culture.",
    band: [0.14, 0.09, 0.05], strip: [0.85, 0.55, 0.10], bandTitle: [0.98, 0.85, 0.55], bandSub: [0.93, 0.89, 0.82],
    heading: [0.62, 0.36, 0.08], rule: [0.85, 0.55, 0.10], ruleWidth: 1.4,
  },
  epure: {
    label: "⬜ Épuré Corporate",
    desc: "Sans bandeau : nom en grand, filets sombres — cabinets, banques, candidatures internationales.",
    band: null, strip: null, bandTitle: null, bandSub: null,
    heading: [0.16, 0.20, 0.26], rule: [0.16, 0.20, 0.26], ruleWidth: 1.6,
    headerName: [0.10, 0.12, 0.15], headerTitle: [0.30, 0.42, 0.58], headerContact: [0.40, 0.44, 0.50],
  },
};

function buildCvPdf(data, templateId) {
  const T = TEMPLATES[templateId] || TEMPLATES.encre;
  const b = [];
  const name = (data.name || "Sans nom").toUpperCase().slice(0, 34);
  const nameSize = name.length > 24 ? 19 : 23;
  const contactLine = [data.contact, data.city].filter(Boolean).join("   ·   ");
  if (T.band) {
    const bandLines = [{ text: name, size: nameSize, bold: true, color: [1, 1, 1] }];
    if (data.title) bandLines.push({ text: data.title, size: 13, color: T.bandTitle });
    if (contactLine) bandLines.push({ text: contactLine, size: 9.8, color: T.bandSub });
    b.push({ band: { color: T.band, strip: T.strip, lines: bandLines } });
  } else {
    b.push({ text: name, size: 25, bold: true, color: T.headerName, spaceBefore: 6 });
    if (data.title) b.push({ text: data.title, size: 13.5, bold: true, color: T.headerTitle, spaceBefore: 3 });
    if (contactLine) b.push({ text: contactLine, size: 10, color: T.headerContact, spaceBefore: 3 });
    b.push({ rule: true, ruleColor: T.rule, ruleWidth: T.ruleWidth, spaceBefore: 10 });
  }
  const section = (title) => {
    b.push({ text: title, size: 12.5, bold: true, color: T.heading, spaceBefore: 15, keepNext: 31 });
    b.push({ rule: true, ruleColor: T.rule, ruleWidth: T.ruleWidth, spaceBefore: 2 });
  };

  if (data.summary) { section("PROFIL"); b.push({ text: data.summary, size: 10.8, color: INK }); }

  const exps = Array.isArray(data.experiences) ? data.experiences : [];
  if (exps.length || data.expRaw) {
    section("EXPÉRIENCES");
    if (exps.length) for (const e of exps) {
      if (e.head) b.push({ text: e.head, size: 11, bold: true, color: INK, spaceBefore: 7, keepNext: 15 });
      if (e.body) b.push({ text: e.body, size: 10.8 });
    } else b.push({ text: data.expRaw, size: 10.8 });
  }

  const forms = Array.isArray(data.formations) ? data.formations : [];
  if (forms.length || data.eduRaw) {
    section("FORMATION");
    if (forms.length) for (const f of forms) b.push({ text: "•  " + f, size: 10.8, spaceBefore: 2 });
    else b.push({ text: data.eduRaw, size: 10.8 });
  }

  const skills = Array.isArray(data.skills) ? data.skills : (data.skillsRaw ? data.skillsRaw.split(",").map(x => x.trim()).filter(Boolean) : []);
  if (skills.length) { section("COMPÉTENCES"); b.push({ text: skills.join("   •   "), size: 10.8 }); }

  const langs = Array.isArray(data.languages) ? data.languages : (data.langRaw ? data.langRaw.split(",").map(x => x.trim()).filter(Boolean) : []);
  if (langs.length) { section("LANGUES"); b.push({ text: langs.join("   •   "), size: 10.8 }); }

  const footerName = (data.name || "CV").slice(0, 30);
  return createPdf(b, { footer: (i, n) => `${footerName} — CV · Page ${i}/${n} · Baara × RealFreeCV (realfreecv.cv)` });
}

module.exports = { buildCvPdf, TEMPLATES };
