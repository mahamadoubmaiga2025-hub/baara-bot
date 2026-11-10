// Baara — bot Emploi & CV (Mali) : Radar d'offres vérifiées, CV PDF + CV adapté à l'offre,
// vérification anti-arnaque d'une offre reçue, alertes avant deadlines. Aucune boutique.
const { PROFILES, OPPORTUNITIES, QUIZ } = require("./data");
const { buildCvPdf, TEMPLATES } = require("./cv");
const { createPdf } = require("./pdf");
const ai = require("./ai");
const { SERVICES, transcriptionPrice, DAILY_GOAL } = require("./catalog");
const { createRfcClient, cvToResume, resumeToCv } = require("./rfc");
const fmtF = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " F CFA";

const PAGE = 3;
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysLeft = (iso) => Math.round((new Date(iso + "T12:00:00Z") - new Date(todayISO() + "T12:00:00Z")) / 86400000);
const profileLabel = (id) => (PROFILES.find(p => p.id === id) || {}).label || id;

const STOP = new Set("avec pour dans les des une est vous nous plus aux sur par pas qui que cette ces leur leurs au du de la le et en à au aux d l s n c j".split(" "));
function keywords(text, max = 22) {
  const norm = (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const seen = [], set = new Set();
  for (const w of norm.replace(/[^a-z0-9 ]/g, " ").split(/\s+/)) {
    if (w.length >= 4 && !STOP.has(w) && !set.has(w)) { set.add(w); seen.push(w); if (seen.length >= max) break; }
  }
  return seen;
}
const normText = (t) => (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const DET_STEPS = [
  { key: "city", prompt: "Question rapide 1/4 pour te proposer les bonnes offres — ta ville ? (ou « passer »)" },
  { key: "diploma", prompt: "2/4 — ton diplôme le plus élevé ? (ex : Licence, Master, Bac, DEF… ou « passer »)" },
  { key: "exp", prompt: "3/4 — tes années d'expérience ? (ex : 0, 2 ans, 5 ans… ou « passer »)" },
  { key: "sectors", prompt: "4/4 — les secteurs qui t'intéressent, séparés par des virgules (ex : comptabilité, santé, éducation… ou « passer »)" },
];
function matchScore(u, o) {
  if (!u.details) return null;
  let score = o.profile === u.profile ? 35 : 18;
  const reasons = [];
  if (o.profile === u.profile) reasons.push("ton profil");
  const hay = normText(o.title + " " + (o.org || "") + " " + (o.summary || ""));
  const d = u.details;
  if (d.city && hay.includes(normText(d.city).split(" ")[0])) { score += 25; reasons.push("ta ville (" + d.city + ")"); }
  if (d.diploma && keywords(d.diploma, 4).some(k => hay.includes(k))) { score += 20; reasons.push("ton diplôme"); }
  if (d.sectors && keywords(d.sectors, 6).some(k => hay.includes(k))) { score += 20; reasons.push("tes secteurs"); }
  return { score: Math.min(98, score), reasons };
}
function extractContacts(text) {
  const out = new Set();
  const emails = String(text).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  emails.forEach(e => out.add(e.toLowerCase()));
  const phones = String(text).replace(/[\s.-]/g, "").match(/(\+?\d{8,15})/g) || [];
  phones.forEach(ph => out.add(ph.replace(/^\+/, "")));
  return [...out].slice(0, 5);
}

// --- Anti-arnaque : signaux locaux, déterministes (aucun appel externe) ---
function analyzeOffer(text) {
  const t = normText(text);
  const signals = [];
  const add = (label, w) => signals.push({ label, w });
  if (/(frais|payer|paiement|depot|caution|envoie[rz]?|transf[ee]r)/.test(t) && /(inscription|dossier|traitement|formation|visa|recrutement)/.test(t)) add("On te demande de PAYER des frais (dossier, inscription, formation…) : un vrai recrutement est gratuit.", 35);
  if (/(code pin|mot de passe|code orange money|code de validation|numero de carte)/.test(t)) add("On te demande un code secret (PIN, mot de passe, code Orange Money) : ne le donne JAMAIS.", 40);
  if (/(urgent|immediatement|aujourd'hui seulement|places limitees|dernieres places|dans les 24)/.test(t)) add("Pression d'urgence (« urgent », « places limitées ») : technique classique pour t'empêcher de réfléchir.", 15);
  if (/(whatsapp|telegram)/.test(t) && !/(@[a-z0-9.-]+\.(org|com|net|ml))/.test(t)) add("Contact uniquement par WhatsApp/Telegram, sans e-mail ni canal officiel vérifiable.", 15);
  if (/(gmail|yahoo|hotmail|outlook)\.(com|fr)/.test(t) && /(ong|societe|entreprise|agence|ministere|banque|international)/.test(t)) add("Une organisation qui recrute depuis une adresse e-mail gratuite (Gmail/Yahoo…) : suspect.", 15);
  if (/(gagner|gagnez|salaire de|revenu de)\s*\d/.test(t) && /(par jour|par semaine|sans experience|a domicile)/.test(t)) add("Promesse de gains élevés sans expérience / à domicile : presque toujours une arnaque.", 25);
  if (/(piece d'identite|passeport|carte bancaire|releve bancaire)/.test(t) && /(avant|d'abord|pour commencer|inscription)/.test(t)) add("Pièces sensibles demandées dès le premier contact, avant tout processus officiel.", 20);
  const score = Math.min(100, signals.reduce((a, s) => a + s.w, 0));
  const verdict = score >= 40 ? "🔴 RISQUE ÉLEVÉ — n'envoie ni argent ni documents, et coupe le contact tant que tu n'as pas vérifié par un canal officiel."
    : score >= 15 ? "🟠 PRUDENCE — plusieurs signaux faibles : vérifie l'offre sur le site officiel de l'organisation avant tout envoi."
    : "🟢 Aucun signal fort détecté dans ce texte — reste vigilant : vérifie quand même le canal officiel et ne paie jamais pour être recruté.";
  return { score, signals, verdict };
}

const CV_STEPS = [
  { key: "name", prompt: "1/8 — Quel est ton nom complet ?" },
  { key: "title", prompt: "2/8 — Quel poste vises-tu ? (ex : Comptable, Enseignant, Développeur…)" },
  { key: "contact", prompt: "3/8 — Ton contact (téléphone et/ou e-mail) ?" },
  { key: "city", prompt: "4/8 — Ta ville ? (ou écris « passer »)" },
  { key: "expRaw", prompt: "5/8 — Tes expériences : poste, entreprise, période, ce que tu faisais. Une ligne par expérience. (ou « passer »)" },
  { key: "eduRaw", prompt: "6/8 — Tes formations et diplômes, un par ligne. (ou « passer »)" },
  { key: "skillsRaw", prompt: "7/8 — Tes compétences, séparées par des virgules. (ou « passer »)" },
  { key: "langRaw", prompt: "8/8 — Tes langues, ex : Français (courant), Bambara (natif), Anglais (moyen). (ou « passer »)" },
];

function createBot({ tg, store, config }) {
  const cfg = config || {};
  const rfc = createRfcClient(cfg);
  async function getConfig() {
    let c = await store.getUser(0);
    if (!c) { c = { id: 0, customOpps: [], relayOpps: [] }; await store.upsertUser(c); }
    if (!Array.isArray(c.customOpps)) c.customOpps = [];
    if (!Array.isArray(c.relayOpps)) c.relayOpps = [];
    if (!c.scamReports || typeof c.scamReports !== "object") c.scamReports = {};
    if (!Array.isArray(c.orders)) c.orders = [];
    if (typeof c.orderSeq !== "number") c.orderSeq = 1000;
    if (!c.lastAdminReport) c.lastAdminReport = "";
    return c;
  }
  async function saveConfig(c) { await store.upsertUser(c); }
  async function allOffers() {
    const c = await getConfig();
    const seen = new Set(); const out = [];
    for (const o of [...c.relayOpps, ...c.customOpps, ...OPPORTUNITIES]) {
      if (!o || !o.deadlineISO || o.deadlineISO < todayISO() || seen.has(o.id)) continue;
      seen.add(o.id); out.push(o);
    }
    return out.sort((a, b) => a.deadlineISO.localeCompare(b.deadlineISO));
  }
  async function ensureUser(from) {
    let u = await store.getUser(from.id);
    if (!u) { u = { id: from.id, firstName: from.first_name || "", profile: null, alerts: true, cvData: null, alerted: {}, tailorDay: "", tailorCount: 0, createdAt: todayISO(), details: null, detFlow: null, applications: {}, quiz: { streak: 0, lastDay: "", points: 0, answeredDay: "" }, lastDigest: "", prepFlow: null, lastScamContacts: [], credit: 0, referredBy: null, refRewarded: false, buyFlow: null, adminFlow: null, pendingBuy: null }; await store.upsertUser(u); }
    if (!u.quiz) u.quiz = { streak: 0, lastDay: "", points: 0, answeredDay: "" };
    if (!u.applications) u.applications = {};
    if (!u.cvTemplate) u.cvTemplate = "encre";
    if (typeof u.credit !== "number") u.credit = 0;
    if (!("referredBy" in u)) u.referredBy = null;
    if (!("refRewarded" in u)) u.refRewarded = false;
    if (!("buyFlow" in u)) u.buyFlow = null;
    if (!("adminFlow" in u)) u.adminFlow = null;
    if (!("pendingBuy" in u)) u.pendingBuy = null;
    if (!("rfc" in u)) u.rfc = null;
    if (!("linkFlow" in u)) u.linkFlow = false;
    return u;
  }
  const send = (chatId, text, kb) => tg.sendMessage(chatId, text, kb ? { reply_markup: { inline_keyboard: kb } } : undefined);
  function mainMenu(u) {
    const kb = [
      [{ text: "📋 Offres pour moi", callback_data: "radar_mine" }, { text: "🔎 Toutes les offres", callback_data: "radar_all" }],
      [{ text: "📄 Mon CV", callback_data: "cv_menu" }, { text: "🛡️ Vérifier une offre", callback_data: "scam_start" }],
      [{ text: u.alerts ? "🔔 Alertes : OUI" : "🔕 Alertes : NON", callback_data: "alerts_toggle" }, { text: "👤 Mon profil", callback_data: "myprofile" }],
      [{ text: "🎯 Question concours du jour", callback_data: "quiz_start" }, { text: "📁 Mes candidatures", callback_data: "myapps" }],
    ];
    kb.push([{ text: "⭐ Services Premium", callback_data: "premium" }, { text: "🎁 Parrainage", callback_data: "ref" }]);
    if (cfg.adminId && u.id === cfg.adminId) kb.push([{ text: "🛠️ Panel Admin", callback_data: "admin" }]);
    return kb;
  }
  async function showMenu(u, chatId, hello) {
    await send(chatId, (hello || "🏠 Que veux-tu faire ?") , mainMenu(u));
  }
  async function showRadar(u, chatId, scope, page) {
    const all = await allOffers();
    const list = scope === "mine" && u.profile ? all.filter(o => o.profile === u.profile || o.profile === "concours") : all;
    if (!list.length) { await send(chatId, "Aucune offre active pour le moment dans cette vue. Reviens bientôt — ou touche « Toutes les offres ».", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
    const pages = Math.ceil(list.length / PAGE);
    const p = Math.min(Math.max(0, page || 0), pages - 1);
    const slice = list.slice(p * PAGE, p * PAGE + PAGE);
    let text = (scope === "mine" ? "📋 Offres pour ton profil (" + profileLabel(u.profile) + ")" : "🔎 Toutes les offres actives") + " — page " + (p + 1) + "/" + pages + " (" + list.length + " offres)\n";
    const kb = [];
    for (const o of slice) {
      const d = daysLeft(o.deadlineISO);
      const ms = matchScore(u, o);
      text += "\n• " + o.title + "\n  🏢 " + (o.org || "") + " — ⏰ " + (o.deadline || o.deadlineISO) + (d <= 3 ? " — ⚠️ plus que " + d + " j !" : "") + (ms ? "\n  🎯 Match " + ms.score + "% (" + ms.reasons.join(", ") + ")" : "") + "\n";
      kb.push([{ text: "🎯 CV adapté — " + o.title.slice(0, 34) + "…", callback_data: "tailor_" + o.id }]);
      kb.push([{ text: "📄 Détails — " + o.title.slice(0, 36) + "…", callback_data: "off_" + o.id }]);
    }
    const nav = [];
    if (p > 0) nav.push({ text: "⬅️ Précédent", callback_data: "rpage_" + scope + "_" + (p - 1) });
    if (p < pages - 1) nav.push({ text: "Suivant ➡️", callback_data: "rpage_" + scope + "_" + (p + 1) });
    if (nav.length) kb.push(nav);
    kb.push([{ text: "🏠 Menu", callback_data: "menu" }]);
    await send(chatId, text, kb);
  }
  async function startCvFlow(u, chatId, pendingTailor) {
    u.cvFlow = { step: 0, data: {}, pendingTailor: pendingTailor || null };
    u.scamFlow = false; u.detFlow = null; await store.upsertUser(u);
    await send(chatId, "📄 Créons ton CV — 8 questions courtes, tu peux écrire « passer » pour sauter une étape.\n\n" + CV_STEPS[0].prompt);
  }
  async function finishCv(u, chatId) {
    const d = u.cvFlow.data;
    const skills = (d.skillsRaw || "").split(",").map(s => s.trim()).filter(Boolean);
    const cv = {
      name: d.name || u.firstName || "Sans nom", title: d.title || "", contact: d.contact || "", city: d.city || "",
      summary: d.title ? (d.title + (skills.length ? " — compétences : " + skills.slice(0, 6).join(", ") + "." : ".")) : "",
      expRaw: d.expRaw || "", eduRaw: d.eduRaw || "", skills, skillsRaw: d.skillsRaw || "", langRaw: d.langRaw || "",
    };
    u.cvData = cv; const pending = u.cvFlow.pendingTailor; u.cvFlow = null; await store.upsertUser(u);
    const pdf = buildCvPdf(cv, u.cvTemplate);
    await tg.sendDocument(chatId, pdf, "CV_" + (cv.name || "Baara").replace(/\s+/g, "_") + ".pdf", "✅ Voici ton CV. Il est sauvegardé dans le bot : tu pourras l'adapter à chaque offre en un toucher.\nPour une version encore plus poussée (modèles pro, score ATS) : RealFreeCV — realfreecv.cv");
    if (u.rfc) { const sp = await syncPush(u); if (sp.ok) await send(chatId, "🔗 Ton CV a aussi été synchronisé sur ton compte RealFreeCV — retrouve-le sur realfreecv.cv (modèles complets, profil public, QR)."); }
    if (pending) { const offers = await allOffers(); const o = offers.find(x => x.id === pending); if (o) await tailorForOffer(u, chatId, o); }
    if (u.pendingBuy) { const pb = u.pendingBuy; u.pendingBuy = null; await store.upsertUser(u); await startBuy(u, chatId, pb.service, pb.payload || {}); }
  }
  function scoreForOffer(cv, offer) {
    const offerKw = keywords(offer.title + " " + (offer.summary || "") + " " + (offer.org || ""));
    const cvText = normText([cv.title, cv.summary, cv.expRaw, cv.eduRaw, cv.skillsRaw, (cv.skills || []).join(" ")].join(" "));
    const matched = offerKw.filter(k => cvText.includes(k));
    const missing = offerKw.filter(k => !cvText.includes(k));
    const score = offerKw.length ? Math.round(100 * matched.length / offerKw.length) : 0;
    return { score, matched, missing };
  }
  async function tailoredData(u, offer) {
    const cv = u.cvData;
    const { matched } = scoreForOffer(cv, offer);
    let adaptedSummary = "Candidature pour : " + offer.title + " (" + (offer.org || "") + ")." + (matched.length ? " Points forts en lien direct avec l'offre : " + matched.slice(0, 6).join(", ") + "." : "") + (cv.summary ? " " + cv.summary : "");
    if (ai.aiAvailable()) {
      const aiSummary = await ai.aiText("Réécris en français le résumé de profil (3 phrases maximum, ton professionnel, première personne, sans inventer aucune expérience ni diplôme) de ce CV pour l'adapter à l'offre visée. CV : poste visé " + cv.title + ", compétences " + (cv.skillsRaw || "") + ", expériences " + (cv.expRaw || "") + ", formations " + (cv.eduRaw || "") + ", résumé actuel " + (cv.summary || "") + ". Offre : " + offer.title + " chez " + (offer.org || "") + " — " + (offer.summary || ""), 350);
      if (aiSummary && aiSummary.length > 30) adaptedSummary = aiSummary.replace(/\s+/g, " ").trim();
    }
    return Object.assign({}, cv, { title: String(offer.title).slice(0, 60), summary: adaptedSummary });
  }
  async function produceTailoredPdf(u, offer) { return buildCvPdf(await tailoredData(u, offer), u.cvTemplate); }
  async function produceLetterPdf(u, offer) {
    const cv = u.cvData;
    let letter = ai.aiAvailable() ? await ai.aiText("Rédige une lettre de motivation formelle en français (250 mots maximum, 4 paragraphes, pas de markdown) pour ce candidat. Candidat : " + cv.name + ", poste actuel/visé : " + cv.title + ", compétences : " + (cv.skillsRaw || "") + ", expériences : " + (cv.expRaw || "") + ", formations : " + (cv.eduRaw || "") + ", ville : " + (cv.city || "") + ", contact : " + (cv.contact || "") + ". Offre : " + offer.title + " chez " + (offer.org || "") + ". " + (offer.summary || "") + " Termine par la formule de politesse et le nom du candidat (sans crochets ni champs à remplir).", 1500) : null;
    if (letter && (letter.length < 500 || !/salutations|respectueusement|cordialement/i.test(letter))) letter = null;
    if (!letter) {
      letter = (cv.city || "Bamako") + ", le " + new Date().toLocaleDateString("fr-FR") + "\n\nObjet : Candidature au poste — " + offer.title + "\n\nMadame, Monsieur,\n\nPar la présente, je vous soumets ma candidature au poste indiqué en objet au sein de " + (offer.org || "votre organisation") + ". " + (cv.title ? "Fort d'un profil de " + cv.title + ", " : "") + "je suis convaincu de pouvoir contribuer efficacement à vos missions.\n\nMes compétences — " + (cv.skillsRaw || "à détailler") + " — ainsi que mon expérience — " + (cv.expRaw || "à détailler") + " — correspondent aux exigences de cette offre. Rigoureux et motivé, je reste disponible pour un entretien à votre convenance.\n\nDans l'attente de votre retour, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n" + cv.name + "\n" + (cv.contact || "");
    }
    const blocks = String(letter).split(/\n+/).filter(Boolean).map(t => ({ text: t, size: 11, spaceBefore: 6 }));
    return createPdf(blocks, { footer: (i, n) => cv.name + " — Lettre de motivation · Page " + i + "/" + n + " · Baara × RealFreeCV" });
  }
  // APERÇU GRATUIT : score + mots-clés (acquisition). La production complète est dans le Pack payant.
  async function tailorForOffer(u, chatId, offer) {
    if (!u.cvData) { await send(chatId, "Pour adapter ton CV à cette offre, je dois d'abord créer ton CV de base — ça prend 2 minutes."); await startCvFlow(u, chatId, offer.id); return; }
    const { score, matched, missing } = scoreForOffer(u.cvData, offer);
    await send(chatId, "🎯 Adaptation à : " + offer.title + "\n🏢 " + (offer.org || "") + "\n\n📊 Score d'adéquation de ton CV actuel : " + score + "/100" +
      (matched.length ? "\n✅ Mots-clés de l'offre présents dans ton CV : " + matched.slice(0, 8).join(", ") : "") +
      (missing.length ? "\n⚠️ Absents de ton CV : " + missing.slice(0, 8).join(", ") + "\nSi certains te correspondent VRAIMENT, ajoute-les dans ton CV (bouton Mon CV → refaire). N'ajoute jamais un mot-clé qui ne te correspond pas : les recruteurs le détectent en entretien." : "\nTon CV couvre tous les mots-clés repérés dans l'offre.") +
      "\n\n⭐ Le CV complet réécrit pour cette offre + ta lettre de motivation personnalisée sont dans le Pack CV + Lettre : " + fmtF(SERVICES.pack.price) + " — les 2 PDF te sont livrés ici même après validation du paiement.",
      [[{ text: "⭐ Commander le Pack CV + Lettre", callback_data: "svco_pack_" + offer.id }], [{ text: "⭐ Tous les services Premium", callback_data: "premium" }], [{ text: "🏠 Menu", callback_data: "menu" }]]);
  }
  async function syncPush(u, opts) {
    if (!u.rfc || !u.rfc.token) return { ok: false, error: "not_linked" };
    const data = (opts && opts.data) || u.cvData;
    if (!data) return { ok: false, error: "no_cv" };
    const resume = cvToResume(data, u.id, opts && opts.suffix);
    const res = await rfc.pushResume(u.rfc.token, resume);
    u.rfc.lastSyncAt = new Date().toISOString();
    if (!res.ok) u.rfc.lastError = res.error + " — " + (res.message || "");
    else if (!String(u.rfc.lastError || "").startsWith("production")) u.rfc.lastError = null;
    await store.upsertUser(u);
    return res;
  }
  function offerTextFor(offer) {
    return [offer.title, offer.org ? "chez " + offer.org : "", offer.text || offer.summary || ""].filter(Boolean).join(". ").slice(0, 6000);
  }
  function produceLetterPdfFromBody(u, body) {
    const cv = u.cvData || {};
    const blocks = String(body).split(/\n+/).filter(Boolean).map(t => ({ text: t, size: 11, spaceBefore: 6 }));
    return createPdf(blocks, { footer: (i, n) => (cv.name || "") + " — Lettre de motivation · Page " + i + "/" + n + " · Baara × RealFreeCV" });
  }
  // Production par RealFreeCV (comptes liés) : analyse IA du site, CV adapté officiel déposé au compte, lettre générée et sauvegardée par le site.
  // Retourne { adaptedCv, letterBody } ou null (quota/panne) — l'appelant retombe alors sur la production locale, la livraison n'est jamais bloquée.
  async function produceViaRfc(u, offer, withLetter) {
    if (!u.rfc || !u.rfc.token || !u.cvData) return null;
    try {
      const resume = cvToResume(u.cvData, u.id);
      const offerText = offerTextFor(offer);
      const a = await rfc.analyze(resume, offerText);
      if (!a.ok) { u.rfc.lastError = "production analyze: " + a.error; await store.upsertUser(u); return null; }
      const t = await rfc.tailor(resume, a.data, offer.title);
      if (!t.ok || !t.data || !t.data.personal) { u.rfc.lastError = "production tailor: " + (t.error || "?"); await store.upsertUser(u); return null; }
      const adaptedRd = t.data;
      adaptedRd.id = "baara-" + u.id + "-" + String(offer.id || "offre").replace(/[^a-z0-9-]/gi, "");
      adaptedRd.title = "CV adapté — " + offer.title;
      adaptedRd.updatedAt = new Date().toISOString();
      await rfc.pushResume(u.rfc.token, adaptedRd);
      let letterBody = null;
      if (withLetter) {
        const l = await rfc.createLetter(u.rfc.token, { resume: adaptedRd, offerText, position: offer.title, company: offer.org || "" });
        if (l.ok && l.data && l.data.body) letterBody = l.data.body;
      }
      u.rfc.lastSyncAt = new Date().toISOString(); u.rfc.lastError = null; await store.upsertUser(u);
      return { adaptedCv: resumeToCv(adaptedRd), letterBody };
    } catch (e) { return null; }
  }
  async function startPrep(u, chatId, offer, premium) {
    await send(chatId, "🎤 Je prépare ta simulation d'entretien" + (premium ? " PREMIUM" : "") + " pour : " + offer.title + "…");
    let qs = null;
    if (ai.aiAvailable()) {
      const raw = await ai.aiText("Donne exactement " + (premium ? 6 : 5) + " questions d'entretien probables (une par ligne, sans numérotation) pour le poste : " + offer.title + " chez " + (offer.org || "") + ". Contexte de l'offre : " + (offer.summary || "") + ". Questions en français, concrètes, du plus simple au plus technique.", premium ? 700 : 500);
      if (raw) qs = raw.split(/\n+/).map(x => x.replace(/^\d+[.)]\s*/, "").trim()).filter(x => x.length > 8).slice(0, premium ? 6 : 5);
    }
    if (!qs || qs.length < 3) qs = ["Présentez-vous en deux minutes.", "Pourquoi voulez-vous ce poste chez " + (offer.org || "cette organisation") + " ?", "Quelle est votre plus grande réussite professionnelle ou scolaire ?", "Comment gérez-vous une difficulté ou un désaccord au travail ?", "Avez-vous des questions pour nous ? (préparez-en deux)"];
    if (!premium) qs = qs.slice(0, 3); // version gratuite : 3 questions, retour court
    u.prepFlow = { offerId: offer.id, title: offer.title, qs, step: 0, premium: !!premium };
    await store.upsertUser(u);
    await send(chatId, "🎤 Simulation d'entretien" + (premium ? " PREMIUM" : "") + " — " + offer.title + "\nRéponds à chaque question comme en vrai entretien" + (premium ? " ; je te corrige en détail après chacune (note, points forts, points faibles, meilleure formulation)." : " ; je te fais un retour court après chacune.") + " (Écris « stop » pour arrêter.)\n\nQuestion 1/" + qs.length + " : " + qs[0]);
  }

  // ================= COMMERCE (freemium) =================
  function snapOffer(o) { return { id: o.id, title: o.title, org: o.org || "", summary: o.summary || "", deadline: o.deadline || o.deadlineISO, deadlineISO: o.deadlineISO, profile: o.profile }; }
  async function findOrder(orderId) { const c = await getConfig(); return { c, order: c.orders.find(o => o.id === orderId) || null }; }
  function activeOrders(c, userId) { return c.orders.filter(o => o.userId === userId && (o.status === "attente_paiement" || o.status === "a_valider")); }
  async function computePricing(u, serviceId, payload) {
    const c = await getConfig();
    const base = serviceId === "transcription" ? transcriptionPrice((payload && payload.durationSec) || 0) : SERVICES[serviceId].price;
    const hasLivre = c.orders.some(o => o.userId === u.id && o.status === "livre");
    const discount = (!hasLivre && u.referredBy) ? Math.round(base * 0.10) : 0;
    const creditUsed = Math.min(u.credit || 0, base - discount);
    return { base, discount, creditUsed, total: base - discount - creditUsed };
  }
  async function showPremium(u, chatId) {
    const kb = Object.entries(SERVICES).map(([id, sv]) => [{ text: sv.emoji + " " + sv.label + " — " + fmtF(sv.price) + (id === "transcription" ? " (≤10 min)" : ""), callback_data: "svc_" + id }]);
    kb.push([{ text: "🏠 Menu", callback_data: "menu" }]);
    await send(chatId, "⭐ Services Premium Baara\nLes fonctions gratuites (radar, CV de base, score d'adéquation, anti-arnaque, question du jour) restent gratuites. Les productions IA avancées sont à l'usage, paiement Orange Money ou Wave, livraison ici même après validation.\n💳 Ton solde de crédits : " + fmtF(u.credit || 0), kb);
  }
  async function pickOfferForBuy(u, chatId) {
    const offers = await allOffers();
    if (!offers.length) { u.buyFlow = null; await store.upsertUser(u); await send(chatId, "Aucune offre active dans le Radar pour le moment — réessaie dès qu'une offre paraît.", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
    await send(chatId, "Pour quelle offre veux-tu ce service ?", offers.slice(0, 8).map(o => [{ text: o.title.slice(0, 42), callback_data: "buypick_" + o.id }]).concat([[{ text: "❌ Annuler", callback_data: "buy_cancel" }]]));
  }
  function buyDetailLine(flow) {
    const p = flow.payload || {};
    if ((flow.service === "pack" || flow.service === "entretien") && p.offer) return "Offre : " + p.offer.title + " (" + (p.offer.org || "") + ")";
    if (flow.service === "cvpro" && p.target) return "Poste visé : " + p.target;
    if (flow.service === "transcription") return "Vocal de " + Math.round(((p.durationSec || 0) / 60) * 10) / 10 + " minute(s)";
    if (flow.service === "doc" && p.doc) return "Document : " + p.doc.type + " — " + (p.doc.objet || "");
    if (flow.service === "cvopt") return "CV optimisé : ton CV enregistré";
    return "";
  }
  async function recapBuy(u, chatId) {
    const flow = u.buyFlow; if (!flow) return;
    const pricing = await computePricing(u, flow.service, flow.payload);
    flow.pricing = pricing; flow.step = "recap"; await store.upsertUser(u);
    const sv = SERVICES[flow.service];
    let t = "🧾 Récapitulatif de ta commande\n\nService : " + sv.emoji + " " + sv.label;
    const det = buyDetailLine(flow); if (det) t += "\n" + det;
    t += "\n\nPrix : " + fmtF(pricing.base);
    if (pricing.discount) t += "\n🎁 Remise parrainage (1re commande, -10 %) : −" + fmtF(pricing.discount);
    if (pricing.creditUsed) t += "\n💳 Tes crédits utilisés : −" + fmtF(pricing.creditUsed);
    t += "\n\n💰 Total à payer : " + fmtF(pricing.total);
    if (pricing.total <= 0) t += "\n\nTes crédits couvrent tout : rien à payer. Confirme et la production démarre immédiatement.";
    await send(chatId, t, [[{ text: pricing.total <= 0 ? "✅ Confirmer — produire maintenant" : "✅ Confirmer — voir le paiement", callback_data: "buy_confirm" }], [{ text: "❌ Annuler", callback_data: "buy_cancel" }]]);
  }
  async function startBuy(u, chatId, serviceId, payload) {
    const sv = SERVICES[serviceId]; if (!sv) return;
    const c = await getConfig();
    if (activeOrders(c, u.id).length >= 3) { await send(chatId, "Tu as déjà 3 commandes en attente. Termine ou annule l'une d'elles avant d'en passer une nouvelle.", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
    if (["pack", "cvpro", "cvopt"].includes(serviceId) && !u.cvData) {
      u.pendingBuy = { service: serviceId, payload: payload || {} }; await store.upsertUser(u);
      await send(chatId, "Pour ce service, j'ai besoin de ton CV. Crée-le en 2 minutes avec le bouton ci-dessous, ou envoie-moi ton CV en PDF : je le lis tout seul, et on reprend ta commande juste après.", [[{ text: "✍️ Créer mon CV", callback_data: "cv_start" }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return;
    }
    u.buyFlow = { service: serviceId, payload: payload || {}, step: "collect" };
    await send(chatId, "⭐ " + sv.label + " — " + fmtF(serviceId === "transcription" ? transcriptionPrice((payload || {}).durationSec || 0) : sv.price) + "\n" + sv.desc);
    if (serviceId === "pack" || serviceId === "entretien") {
      if (u.buyFlow.payload.offer) { await recapBuy(u, chatId); return; }
      await store.upsertUser(u); await pickOfferForBuy(u, chatId); return;
    }
    if (serviceId === "cvpro") { await store.upsertUser(u); await send(chatId, "🎯 Quel poste ou secteur vises-tu avec ce CV ? (ex : « Assistant finance en ONG », « Commercial terrain dans les télécoms »)"); return; }
    if (serviceId === "doc") {
      u.buyFlow.step = "doc_type"; await store.upsertUser(u);
      await send(chatId, "📝 Quel type de document te faut-il ?", [[{ text: "📊 Rapport", callback_data: "buydoc_rapport" }, { text: "✉️ Lettre administrative", callback_data: "buydoc_lettre" }], [{ text: "🧾 Devis", callback_data: "buydoc_devis" }, { text: "📄 Autre document", callback_data: "buydoc_autre" }]]); return;
    }
    await recapBuy(u, chatId); // cvopt, transcription
  }
  async function confirmBuy(u, chatId) {
    const flow = u.buyFlow; if (!flow || flow.step !== "recap") return;
    const pricing = await computePricing(u, flow.service, flow.payload);
    const c = await getConfig();
    if (activeOrders(c, u.id).length >= 3) { await send(chatId, "Tu as déjà 3 commandes en attente — commande annulée."); u.buyFlow = null; await store.upsertUser(u); return; }
    const order = { id: "CMD-" + (++c.orderSeq), userId: u.id, userName: u.cvData ? u.cvData.name : (u.firstName || ""), service: flow.service, label: SERVICES[flow.service].label, base: pricing.base, discount: pricing.discount, creditUsed: pricing.creditUsed, total: pricing.total, payload: flow.payload, status: "attente_paiement", createdAt: new Date().toISOString(), r2: false, r24: false };
    c.orders.push(order); await saveConfig(c);
    if (pricing.creditUsed) u.credit = Math.max(0, (u.credit || 0) - pricing.creditUsed);
    u.buyFlow = null; await store.upsertUser(u);
    if (order.total <= 0) {
      order.paidVia = "credits"; await saveConfig(c);
      await send(chatId, "✅ Commande " + order.id + " confirmée — intégralement payée par tes crédits. Production en cours…");
      await deliverOrder(order.id); return;
    }
    await send(chatId, "💳 Paiement — commande " + order.id + "\n\nMontant exact : " + fmtF(order.total) + "\n🟠 Orange Money : " + (cfg.omNumber || "à configurer") + "\n🔵 Wave : " + (cfg.waveNumber || "à configurer") + "\n📌 Motif / référence à indiquer : " + order.id + "\n\nPaie exactement ce montant, puis touche « ✅ J'ai payé » et envoie-moi la capture d'écran du paiement (ou le code de transaction en texte). Tes documents sont produits dès la validation.",
      [[{ text: "✅ J'ai payé", callback_data: "buy_paid_" + order.id }], [{ text: "❌ Annuler la commande", callback_data: "buy_abandon_" + order.id }]]);
  }
  async function notifyAdminOrder(order, u) {
    if (!cfg.adminId) return;
    await send(cfg.adminId, "💰 Paiement à valider — " + order.id + "\nClient : " + (order.userName || "") + " (id " + order.userId + ")\nService : " + order.label + "\nMontant payé annoncé : " + fmtF(order.total) + " (prix " + fmtF(order.base) + (order.discount ? ", remise −" + fmtF(order.discount) : "") + (order.creditUsed ? ", crédits −" + fmtF(order.creditUsed) : "") + ")\nPreuve : " + (order.proof ? order.proof.type : "—") + (order.proof && order.proof.value ? " — " + order.proof.value : ""),
      [[{ text: "✅ Valider — produire", callback_data: "admv_ok_" + order.id }, { text: "❌ Rejeter", callback_data: "admv_no_" + order.id }]]).catch(() => {});
  }
  async function afterPaid(u, order) {
    if (u.referredBy && !u.refRewarded && order.base > 0) {
      u.refRewarded = true; await store.upsertUser(u);
      const parrain = await store.getUser(u.referredBy).catch(() => null);
      if (parrain) { parrain.credit = (parrain.credit || 0) + 500; await store.upsertUser(parrain); await tg.sendMessage(parrain.id, "🎁 Ton filleul vient de terminer sa première commande payée sur Baara : +500 F CFA de crédit ajoutés à ton solde (utilisables sur tous les services Premium).").catch(() => {}); }
    }
  }
  async function deliverOrder(orderId) {
    const { c, order } = await findOrder(orderId);
    if (!order || order.status === "livre") return;
    const u = await store.getUser(order.userId).catch(() => null);
    if (!u) { order.status = "rejete"; order.rejectReason = "compte introuvable"; await saveConfig(c); return; }
    const chatId = u.id; const p = order.payload || {};
    try {
      if (order.service === "pack") {
        const prod = await produceViaRfc(u, p.offer, true);
        if (prod) {
          const pdf1 = buildCvPdf(prod.adaptedCv, u.cvTemplate);
          await tg.sendDocument(chatId, pdf1, "CV_adapte_" + p.offer.id + ".pdf", "⭐ PACK CV + Lettre (1/2) — ton CV adapté à : " + p.offer.title + " · produit par RealFreeCV, il est aussi dans ton compte sur realfreecv.cv.");
          const pdf2 = prod.letterBody ? produceLetterPdfFromBody(u, prod.letterBody) : await produceLetterPdf(u, p.offer);
          await tg.sendDocument(chatId, pdf2, "Lettre_" + p.offer.id + ".pdf", "⭐ PACK CV + Lettre (2/2) — ta lettre de motivation" + (prod.letterBody ? ", rédigée et sauvegardée par RealFreeCV dans ton compte" : " personnalisée") + ". Relis-la, personnalise une phrase avec un fait précis sur l'organisation, et fonce. Bonne chance ! 🍀");
        } else {
          const adapted = await tailoredData(u, p.offer);
          if (u.rfc) await syncPush(u, { data: adapted, suffix: String(p.offer.id || "").replace(/[^a-z0-9-]/gi, "") });
          const pdf1 = buildCvPdf(adapted, u.cvTemplate);
          await tg.sendDocument(chatId, pdf1, "CV_adapte_" + p.offer.id + ".pdf", "⭐ PACK CV + Lettre (1/2) — ton CV adapté à : " + p.offer.title);
          const pdf2 = await produceLetterPdf(u, p.offer);
          await tg.sendDocument(chatId, pdf2, "Lettre_" + p.offer.id + ".pdf", "⭐ PACK CV + Lettre (2/2) — ta lettre de motivation personnalisée. Relis-la, personnalise une phrase avec un fait précis sur l'organisation, et fonce. Bonne chance ! 🍀");
        }
      } else if (order.service === "cvpro") {
        const cv = u.cvData; const target = p.target || cv.title || "";
        let summary = "Candidature pour : " + target + ". " + (cv.summary || "");
        if (ai.aiAvailable()) { const sm = await ai.aiText("Réécris en français le résumé de profil (3 phrases maximum, première personne, ton professionnel, sans inventer diplômes ni employeurs) de ce CV pour viser ce poste/secteur : « " + target + " ». CV : compétences " + (cv.skillsRaw || "") + ", expériences " + (cv.expRaw || "") + ", formations " + (cv.eduRaw || "") + ", résumé actuel " + (cv.summary || ""), 350); if (sm && sm.length > 30) summary = sm.replace(/\s+/g, " ").trim(); }
        const pdf = buildCvPdf(Object.assign({}, cv, { title: String(target).slice(0, 60), summary }), u.cvTemplate);
        if (u.rfc) await syncPush(u, { data: Object.assign({}, cv, { title: String(target).slice(0, 60), summary }), suffix: "cvpro" });
        await tg.sendDocument(chatId, pdf, "CV_pro.pdf", "⭐ Voici ton CV pro adapté pour : " + target);
      } else if (order.service === "cvopt") {
        const cv = u.cvData; let summary = cv.summary, skills = cv.skills || [];
        if (ai.aiAvailable()) {
          const raw = await ai.aiText("Optimise ce CV pour les recruteurs et les logiciels de tri ATS. Réponds en JSON strict {\"summary\": \"...\", \"skills\": \"compétence 1, compétence 2\"} : résumé réécrit (3 phrases, mots-clés du poste visé, sans rien inventer) et compétences nettoyées, dédupliquées, ordonnées par pertinence. Poste visé : " + (cv.title || "") + ". Résumé actuel : " + (cv.summary || "") + ". Compétences : " + (cv.skillsRaw || "") + ". Expériences : " + (cv.expRaw || ""), 600);
          const d = ai.parseJsonLoose(raw);
          if (d) { if (d.summary) summary = String(d.summary); if (d.skills) skills = String(d.skills).split(",").map(x => x.trim()).filter(Boolean); }
        }
        const optData = Object.assign({}, cv, { summary, skills, skillsRaw: skills.join(", ") });
        const pdf = buildCvPdf(optData, u.cvTemplate);
        await tg.sendDocument(chatId, pdf, "CV_optimise.pdf", "⭐ Voici ton CV optimisé ATS : résumé renforcé et compétences ordonnées pour passer les tris automatiques.");
        if (u.rfc) await syncPush(u, { data: optData });
      } else if (order.service === "entretien") {
        order.status = "livre"; order.deliveredAt = new Date().toISOString(); await saveConfig(c);
        await startPrep(u, chatId, p.offer, true); await afterPaid(u, order); return;
      } else if (order.service === "transcription") {
        if (!tg.downloadFile) throw new Error("téléchargement indisponible");
        const buf = await tg.downloadFile(p.fileId); if (!buf) throw new Error("audio illisible");
        const raw = await ai.aiMedia(buf.toString("base64"), "audio/ogg", "Transcris fidèlement et intégralement ce message vocal en français. Ne rends que la transcription, sans aucun commentaire.", 4000);
        if (!raw) throw new Error("transcription vide");
        await send(chatId, "⭐ Voici la transcription intégrale de ton vocal (" + Math.round(((p.durationSec || 0) / 60) * 10) / 10 + " min) :");
        for (let i = 0; i < raw.length; i += 3800) await send(chatId, raw.slice(i, i + 3800));
      } else if (order.service === "doc") {
        const d = p.doc || {}; const cv = u.cvData || {};
        const who = cv.name || u.firstName || "";
        let body = null;
        if (ai.aiAvailable()) body = await ai.aiText("Rédige en français un document formel complet, prêt à imprimer et signer. Type : " + d.type + ". Objet : " + d.objet + ". Destinataire : " + d.destinataire + ". Points à couvrir : " + d.points + ". Émetteur : " + who + (cv.title ? ", " + cv.title : "") + (cv.city ? ", " + cv.city : "") + (cv.contact ? ", contact : " + cv.contact : "") + ". Structure professionnelle (lieu et date, objet, corps structuré, formule de politesse, signature avec le nom), sans markdown, sans crochets ni champs à remplir.", 1500);
        if (!body || body.length < 300) body = (cv.city || "Bamako") + ", le " + new Date().toLocaleDateString("fr-FR") + "\n\n" + who + (cv.contact ? "\n" + cv.contact : "") + "\n\nÀ " + (d.destinataire || "Madame, Monsieur") + "\n\nObjet : " + (d.objet || d.type) + "\n\nMadame, Monsieur,\n\n" + (d.points || "") + "\n\nDans l'attente de votre retour, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n" + who;
        const blocks = String(body).split(/\n+/).filter(Boolean).map(t => ({ text: t, size: 11, spaceBefore: 6 }));
        const pdf = createPdf(blocks, { footer: (i, n) => who + " — Document sur mesure · Page " + i + "/" + n + " · Baara" });
        await tg.sendDocument(chatId, pdf, "Document_sur_mesure.pdf", "⭐ Voici ton document sur mesure. Relis-le attentivement avant de le signer.");
      }
      order.status = "livre"; order.deliveredAt = new Date().toISOString(); await saveConfig(c);
      await afterPaid(u, order);
    } catch (e) {
      console.error("Baara deliverOrder", order.id, e.message);
      await send(chatId, "⚠️ Ta commande " + order.id + " est bien validée, mais la production automatique a rencontré un souci technique. Le responsable a été prévenu : tes documents arrivent très vite, sans que tu aies à repayer.").catch(() => {});
      if (cfg.adminId) await send(cfg.adminId, "⚠️ Production en échec — " + order.id + " (" + order.service + ", client " + order.userId + ") : " + e.message + ". Relance possible en revalidant la commande depuis le panneau admin.").catch(() => {});
    }
  }
  async function statsText() {
    const c = await getConfig();
    const livre = c.orders.filter(o => o.status === "livre");
    const t = todayISO(), m = t.slice(0, 7);
    const sum = (arr) => arr.reduce((a, o) => a + (o.total || 0), 0);
    const jour = livre.filter(o => (o.deliveredAt || "").slice(0, 10) === t);
    const mois = livre.filter(o => (o.deliveredAt || "").slice(0, 7) === m);
    const parService = {};
    for (const o of livre) parService[o.label] = (parService[o.label] || 0) + 1;
    const ecart = sum(jour) - DAILY_GOAL;
    return "📊 Stats Baara Business\n• CA encaissé aujourd'hui : " + fmtF(sum(jour)) + " (objectif " + fmtF(DAILY_GOAL) + " — écart : " + (ecart >= 0 ? "+" : "−") + fmtF(Math.abs(ecart)).replace(" F CFA", "") + " F CFA)\n• CA encaissé ce mois : " + fmtF(sum(mois)) + "\n• Commandes livrées : " + jour.length + " aujourd'hui · " + mois.length + " ce mois" +
      (Object.keys(parService).length ? "\n• Par service (total) : " + Object.entries(parService).map(([k, v]) => k + " ×" + v).join(", ") : "") +
      "\n• À valider : " + c.orders.filter(o => o.status === "a_valider").length + " · En attente de paiement : " + c.orders.filter(o => o.status === "attente_paiement").length;
  }
  async function buildAdminReport() {
    const c = await getConfig();
    const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const livre = c.orders.filter(o => o.status === "livre" && (o.deliveredAt || "").slice(0, 10) === hier);
    const ca = livre.reduce((a, o) => a + (o.total || 0), 0);
    const users = (await store.listUsers()).filter(x => x.id !== 0);
    const nouveaux = users.filter(x => x.createdAt === hier).length;
    const attente = c.orders.filter(o => o.status === "a_valider" || o.status === "attente_paiement").length;
    return "☀️ Rapport Baara Business — hier (" + hier + ")\n• CA encaissé : " + fmtF(ca) + " (objectif " + fmtF(DAILY_GOAL) + "/jour)\n• Commandes livrées : " + livre.length + (livre.length ? " — " + livre.map(o => o.label).join(", ") : "") + "\n• Nouveaux utilisateurs : " + nouveaux + " (total : " + users.length + ")\n• Commandes en attente : " + attente;
  }
  // ================= FIN COMMERCE =================

  async function handleUpdate(upd) {
    const msg = upd.message; const cb = upd.callback_query;
    const chatId = msg ? msg.chat.id : cb ? cb.message.chat.id : null;
    const from = msg ? msg.from : cb ? cb.from : null;
    if (!chatId || !from) return;
    if (cb) await tg.answerCallbackQuery(cb.id).catch(() => {});
    const preUser = msg ? await store.getUser(from.id).catch(() => null) : null;
    const u = await ensureUser(from);
    const data = cb ? cb.data : null;
    const text = msg ? (msg.text || "") : "";

    if (msg && !preUser && /^\/start\s+ref_(\d+)/.test(text || "")) {
      const refId = Number((text.match(/^\/start\s+ref_(\d+)/) || [])[1]);
      if (refId && refId !== u.id && (await store.getUser(refId).catch(() => null))) {
        u.referredBy = refId; await store.upsertUser(u);
        await tg.sendMessage(refId, "🎁 Bonne nouvelle : " + (u.firstName || "un nouvel utilisateur") + " vient de rejoindre Baara avec ton lien de parrainage. Il a 10 % sur sa première commande — et tu recevras 500 F CFA de crédit quand elle sera payée.").catch(() => {});
      }
    }
    if (cb) {
      if (data === "menu") { await showMenu(u, chatId); return; }
      if (data.startsWith("prof_")) {
        const isNew = !u.details;
        u.profile = data.slice(5);
        if (isNew) { u.detFlow = { step: 0, data: {} }; await store.upsertUser(u); await send(chatId, "✅ Profil enregistré : " + profileLabel(u.profile) + "\n\n" + DET_STEPS[0].prompt); return; }
        await store.upsertUser(u);
        await send(chatId, "✅ Catégorie mise à jour : " + profileLabel(u.profile));
        await showMenu(u, chatId); return;
      }
      if (data === "myprofile") { await send(chatId, "👤 Ton profil\n• Nom : " + (u.firstName || "—") + "\n• Catégorie : " + (u.profile ? profileLabel(u.profile) : "non choisie") + "\n• Alertes deadlines : " + (u.alerts ? "activées" : "coupées") + "\n• CV enregistré : " + (u.cvData ? "oui (" + (u.cvData.title || "sans poste visé") + ")" : "non") + "\n• Crédits : " + fmtF(u.credit || 0), [[{ text: "Changer de catégorie", callback_data: "change_profile" }, { text: "🔗 RealFreeCV", callback_data: "rfc" }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
      if (data === "change_profile") { await send(chatId, "Choisis ta catégorie :", PROFILES.map(p => [{ text: p.label, callback_data: "prof_" + p.id }])); return; }
      if (data === "radar_mine") { await showRadar(u, chatId, "mine", 0); return; }
      if (data === "radar_all") { await showRadar(u, chatId, "all", 0); return; }
      if (data.startsWith("rpage_")) { const parts = data.split("_"); await showRadar(u, chatId, parts[1], Number(parts[2]) || 0); return; }
      if (data.startsWith("off_")) {
        const offers = await allOffers(); const o = offers.find(x => x.id === data.slice(4));
        if (!o) { await send(chatId, "Cette offre n'est plus active."); return; }
        const ms = matchScore(u, o);
        await send(chatId, "📄 " + o.title + "\n🏢 " + (o.org || "") + "\n⏰ Date limite : " + (o.deadline || o.deadlineISO) + (ms ? "\n🎯 Ton match : " + ms.score + "% (" + ms.reasons.join(", ") + ")" : "") + "\n\n" + (o.summary || ""), [
          [{ text: "🎯 CV adapté à cette offre", callback_data: "tailor_" + o.id }],
          [{ text: "✉️ Lettre de motivation", callback_data: "lettre_" + o.id }, { text: "🎤 Préparer l'entretien", callback_data: "prep_" + o.id }],
          [{ text: "📋 Checklist du dossier", callback_data: "check_" + o.id }, { text: "✅ J'ai postulé", callback_data: "postule_" + o.id }],
          [{ text: "📤 Partager sur WhatsApp", url: "https://wa.me/?text=" + encodeURIComponent(o.title + " — " + (o.org || "") + " — date limite : " + (o.deadline || o.deadlineISO) + " · Offre vue sur Baara, l'assistant Emploi & CV du Mali : https://t.me/" + (cfg.botUsername || "Baaramlbot")) }],
          [{ text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data.startsWith("tailor_")) { const offers = await allOffers(); const o = offers.find(x => x.id === data.slice(7)); if (o) await tailorForOffer(u, chatId, o); else await send(chatId, "Cette offre n'est plus active."); return; }
      if (data === "cv_menu") {
        if (u.cvData) await send(chatId, "📄 Ton CV enregistré vise : " + (u.cvData.title || "—") + ".\nModèle actuel : " + ((TEMPLATES[u.cvTemplate] || {}).label || "Classique Encre") + "\nTu peux le recevoir à nouveau en PDF, changer de modèle, ou le refaire entièrement.", [[{ text: "📥 Recevoir mon CV en PDF", callback_data: "cv_send" }], [{ text: "🎨 Changer de modèle", callback_data: "tpl_menu" }, { text: "♻️ Refaire mon CV", callback_data: "cv_start" }], [{ text: "🔗 RealFreeCV", callback_data: "rfc" }], [{ text: "🏠 Menu", callback_data: "menu" }]]);
        else await send(chatId, "Tu n'as pas encore de CV dans Baara. Je te le crée en 8 questions, puis je pourrai l'adapter à chaque offre.", [[{ text: "✍️ Créer mon CV", callback_data: "cv_start" }], [{ text: "🔗 Lier mon compte RealFreeCV", callback_data: "rfc" }], [{ text: "🏠 Menu", callback_data: "menu" }]]);
        return;
      }
      if (data === "cv_start") { await startCvFlow(u, chatId, null); return; }
      if (data === "cv_send") { const pdf = buildCvPdf(u.cvData, u.cvTemplate); await tg.sendDocument(chatId, pdf, "CV_" + (u.cvData.name || "Baara").replace(/\s+/g, "_") + ".pdf", "📄 Voici ton CV."); return; }
      if (data === "scam_start") { u.scamFlow = true; u.cvFlow = null; await store.upsertUser(u); await send(chatId, "🛡️ Colle ici le texte complet de l'offre ou du message que tu as reçu (annonce, SMS, WhatsApp…). Je vais chercher les signaux d'arnaque : demande d'argent, urgence fabriquée, contacts invérifiables…"); return; }
      if (data === "alerts_toggle") { u.alerts = !u.alerts; await store.upsertUser(u); await send(chatId, u.alerts ? "🔔 Alertes activées : je te préviendrai 3 jours avant les dates limites de ton profil." : "🔕 Alertes coupées. Tu peux les réactiver quand tu veux."); await showMenu(u, chatId); return; }
      if (data === "quiz_start") {
        const today = todayISO();
        if (u.quiz.answeredDay === today) { await send(chatId, "✅ Tu as déjà répondu à la question du jour. Série en cours : 🔥 " + u.quiz.streak + " jour(s) — " + u.quiz.points + " points. Reviens demain !", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
        const dayIdx = Math.floor(Date.now() / 86400000) % QUIZ.length;
        const qz = QUIZ[dayIdx];
        await send(chatId, "🎯 Question concours du jour\n\n" + qz.q, qz.options.map((o, i) => [{ text: o, callback_data: "qans_" + dayIdx + "_" + i }]));
        return;
      }
      if (data.startsWith("qans_")) {
        const parts = data.split("_"); const qz = QUIZ[Number(parts[1])]; const chosen = Number(parts[2]);
        if (!qz || u.quiz.answeredDay === todayISO()) { await send(chatId, "Question déjà traitée pour aujourd'hui."); return; }
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        u.quiz.streak = u.quiz.lastDay === yesterday ? u.quiz.streak + 1 : 1;
        u.quiz.lastDay = todayISO(); u.quiz.answeredDay = todayISO();
        const good = chosen === qz.answer;
        if (good) u.quiz.points += 10;
        await store.upsertUser(u);
        const users = (await store.listUsers()).filter(x => x.id !== 0);
        const rank = 1 + users.filter(x => (x.quiz?.points || 0) > u.quiz.points).length;
        await send(chatId, (good ? "✅ Bonne réponse ! +10 points." : "❌ Raté — la bonne réponse était : " + qz.options[qz.answer] + ".") + "\n💡 " + qz.why + "\n\n🔥 Série : " + u.quiz.streak + " jour(s) · ⭐ " + u.quiz.points + " points · 🏆 Rang : " + rank + "e/" + users.length, [[{ text: "🏠 Menu", callback_data: "menu" }]]);
        return;
      }
      if (data === "myapps") {
        const apps = Object.entries(u.applications || {});
        if (!apps.length) { await send(chatId, "📁 Tu n'as pas encore de candidature suivie. Sur une offre, touche « ✅ J'ai postulé » et je suivrai le dossier avec toi (rappel de relance à 7 jours).", [[{ text: "📋 Voir les offres", callback_data: "radar_mine" }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
        let t = "📁 Tes candidatures suivies\n";
        for (const [oid, a] of apps) t += "\n• " + a.title + "\n  Postulé le " + a.date + " — " + (a.org || "") + "\n";
        await send(chatId, t, [[{ text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data.startsWith("postule_")) {
        const offers = await allOffers(); const o = offers.find(x => x.id === data.slice(8));
        if (!o) { await send(chatId, "Cette offre n'est plus active."); return; }
        u.applications[o.id] = { title: o.title, org: o.org || "", date: todayISO(), reminded: false };
        await store.upsertUser(u);
        await send(chatId, "✅ Candidature enregistrée pour : " + o.title + "\nJe te rappellerai dans 7 jours de relancer poliment si tu n'as pas de réponse. Bonne chance ! 🍀", [[{ text: "📁 Mes candidatures", callback_data: "myapps" }, { text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data.startsWith("check_")) {
        const offers = await allOffers(); const o = offers.find(x => x.id === data.slice(6));
        if (!o) { await send(chatId, "Cette offre n'est plus active."); return; }
        const items = o.profile === "concours"
          ? ["Pièce d'identité (carte NINA ou passeport)", "Acte de naissance", "Copie légalisée du diplôme requis", "Casier judiciaire (si demandé dans l'avis)", "Photos d'identité récentes", "Récépissé / fiche de dépôt du dossier", "Ce bot ouvert sur l'offre pour la date limite exacte 😊"]
          : ["CV adapté à l'offre (bouton 🎯 ci-dessus sur la fiche)", "Lettre de motivation (bouton ✉️)", "Copies des diplômes et attestations", "Certificats de travail / stage", "Pièce d'identité", "Références joignables (noms + téléphones)"];
        await send(chatId, "📋 Checklist du dossier — " + o.title + "\n🏢 " + (o.org || "") + " · ⏰ " + (o.deadline || o.deadlineISO) + "\n" + items.map(i => "\n☐ " + i).join("") + "\n\nPrépare tout AVANT la date limite : les dossiers incomplets sont éliminés sans examen.", [[{ text: "🎯 CV adapté", callback_data: "tailor_" + o.id }, { text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data.startsWith("lettre_")) {
        const offers = await allOffers(); const o = offers.find(x => x.id === data.slice(7));
        if (!o) { await send(chatId, "Cette offre n'est plus active."); return; }
        if (!u.cvData) { await send(chatId, "J'ai besoin de ton CV pour écrire ta lettre. Créons-le d'abord (2 minutes)."); await startCvFlow(u, chatId, null); return; }
        await send(chatId, "✉️ La lettre de motivation personnalisée fait partie du Pack CV + Lettre : ton CV réécrit pour « " + o.title + " » + ta lettre, les 2 PDF pour " + fmtF(SERVICES.pack.price) + ".\nLe score d'adéquation, lui, reste gratuit (bouton 🎯 CV adapté).", [[{ text: "⭐ Commander le Pack pour cette offre", callback_data: "svco_pack_" + o.id }], [{ text: "⭐ Tous les services Premium", callback_data: "premium" }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data.startsWith("prep_")) {
        const offers = await allOffers(); const o = offers.find(x => x.id === data.slice(5));
        if (!o) { await send(chatId, "Cette offre n'est plus active."); return; }
        await startPrep(u, chatId, o, false); return;
      }
      if (data.startsWith("report_")) {
        const contacts = u.lastScamContacts || [];
        if (!contacts.length) { await send(chatId, "Aucun contact à signaler sur la dernière analyse."); return; }
        const c = await getConfig();
        for (const ct of contacts) c.scamReports[ct] = (c.scamReports[ct] || 0) + 1;
        await saveConfig(c);
        await send(chatId, "🚨 Merci. Ces contacts sont maintenant signalés dans Baara : " + contacts.join(", ") + ". Si d'autres utilisateurs reçoivent une offre venant d'eux, ils seront prévenus.", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data === "tpl_menu") {
        await send(chatId, "🎨 Choisis le modèle de tes CV — je te renvoie aussitôt TON CV dans le modèle choisi, pour juger sur pièce :", Object.entries(TEMPLATES).map(([id, t]) => [{ text: (u.cvTemplate === id ? "✅ " : "") + t.label, callback_data: "tpl_" + id }]));
        return;
      }
      if (data.startsWith("tpl_")) {
        const id = data.slice(4);
        if (!TEMPLATES[id]) return;
        u.cvTemplate = id; await store.upsertUser(u);
        if (u.cvData) { const pdf = buildCvPdf(u.cvData, id); await tg.sendDocument(chatId, pdf, "CV_" + (u.cvData.name || "Baara").replace(/\s+/g, "_") + ".pdf", "🎨 Voici TON CV dans le modèle « " + TEMPLATES[id].label + " ».\n" + TEMPLATES[id].desc + "\nCe modèle sera utilisé pour tous tes prochains CV, y compris les CV adaptés aux offres."); }
        else await send(chatId, "✅ Modèle « " + TEMPLATES[id].label + " » enregistré — il s'appliquera à ton CV dès sa création.");
        return;
      }
      if (data === "premium") { await showPremium(u, chatId); return; }
      if (data === "ref") {
        const users = await store.listUsers();
        const filleuls = users.filter(x => x.id !== 0 && x.referredBy === u.id).length;
        await send(chatId, "🎁 Parrainage Baara\n\nTon lien personnel :\nhttps://t.me/" + (cfg.botUsername || "Baaramlbot") + "?start=ref_" + u.id + "\n\n• Tes filleuls reçoivent 10 % de remise sur leur première commande.\n• Tu reçois 500 F CFA de crédit à leur première commande payée.\n• Tes crédits sont utilisables sur tous les services Premium.\n\n💳 Ton solde de crédits : " + fmtF(u.credit || 0) + "\n👥 Tes filleuls : " + filleuls, [[{ text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data.startsWith("svco_")) { const rest = data.slice(5); const cut = rest.indexOf("_"); const offers = await allOffers(); const o = offers.find(x => x.id === rest.slice(cut + 1)); await startBuy(u, chatId, rest.slice(0, cut), o ? { offer: snapOffer(o) } : {}); return; }
      if (data.startsWith("svc_")) { await startBuy(u, chatId, data.slice(4), {}); return; }
      if (data.startsWith("buypick_")) { if (u.buyFlow) { const offers = await allOffers(); const o = offers.find(x => x.id === data.slice(8)); if (o) { u.buyFlow.payload.offer = snapOffer(o); await recapBuy(u, chatId); } else await send(chatId, "Cette offre n'est plus active."); } return; }
      if (data === "buy_confirm") { await confirmBuy(u, chatId); return; }
      if (data === "buy_cancel") { u.buyFlow = null; await store.upsertUser(u); await send(chatId, "Commande annulée — rien n'a été débité.", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
      if (data.startsWith("buy_paid_")) { const oid = data.slice(9); const found = await findOrder(oid); if (found.order && found.order.userId === u.id && found.order.status === "attente_paiement") { u.buyFlow = { step: "proof", orderId: oid }; await store.upsertUser(u); await send(chatId, "📸 Envoie-moi maintenant la capture d'écran de ton paiement de " + fmtF(found.order.total) + " (ou le code de transaction en texte). Référence de la commande : " + oid); } else await send(chatId, "Cette commande n'attend plus de paiement."); return; }
      if (data.startsWith("buy_abandon_")) { const found = await findOrder(data.slice(12)); if (found.order && found.order.userId === u.id && found.order.status === "attente_paiement") { found.order.status = "abandonne"; await saveConfig(found.c); await send(chatId, "Commande " + found.order.id + " annulée."); } return; }
      if (data.startsWith("buydoc_")) { if (u.buyFlow && u.buyFlow.service === "doc") { u.buyFlow.payload.doc = { type: data.slice(7) }; u.buyFlow.step = "doc_objet"; await store.upsertUser(u); await send(chatId, "📝 Objet du document ? (ex : « Demande de stage », « Rapport d'activité du mois de juin », « Devis pour la rénovation d'un bureau »)"); } return; }
      if (data === "rfc") {
        if (!rfc.configured()) { await send(chatId, "🔗 La liaison RealFreeCV arrive très bientôt sur Baara. En attendant, ton CV est exportable en PDF à tout moment (Mon CV).", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
        if (!u.rfc) {
          await send(chatId, "🔗 Lier ton compte RealFreeCV\n\nAvantages : ton CV Baara vit aussi sur realfreecv.cv (11 modèles complets, profil public, QR code), et tes CV adaptés achetés ici y sont déposés.\n\nComment faire :\n1. Va sur realfreecv.cv → Mon compte → Applications liées\n2. Génère un code de liaison (valable 30 minutes)\n3. Reviens ici et touche « J'ai mon code », puis colle-le-moi.", [[{ text: "🔑 J'ai mon code", callback_data: "rfc_link" }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return;
        }
        await send(chatId, "🔗 Compte RealFreeCV lié : " + (u.rfc.label || "") + "\nDernière synchro : " + (u.rfc.lastSyncAt ? u.rfc.lastSyncAt.slice(0, 16).replace("T", " ") : "jamais") + (u.rfc.lastError ? "\n⚠️ Dernière erreur : " + u.rfc.lastError : ""), [[{ text: "⬆️ Synchroniser mon CV vers le site", callback_data: "rfc_sync" }], [{ text: "⬇️ Récupérer un CV du site", callback_data: "rfc_pull" }], [{ text: "🔓 Délier ce compte", callback_data: "rfc_unlink" }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data === "rfc_link") { u.linkFlow = true; await store.upsertUser(u); await send(chatId, "🔑 Colle-moi le code de liaison généré sur realfreecv.cv (8 caractères). Il expire après 30 minutes et ne sert qu'une fois."); return; }
      if (data === "rfc_sync") {
        if (!u.rfc) { await send(chatId, "Aucun compte lié pour le moment."); return; }
        if (!u.cvData) { await send(chatId, "Tu n'as pas encore de CV dans Baara à synchroniser."); return; }
        const res = await syncPush(u);
        if (res.ok) await send(chatId, "✅ CV synchronisé sur RealFreeCV. Retrouve-le dans ton compte sur realfreecv.cv.");
        else if (res.error === "cv_limit") await send(chatId, "⚠️ Ton compte RealFreeCV gratuit a atteint son plafond de CV — impossible d'y ajouter celui-ci. Supprime un ancien CV sur le site, ou passe Pro là-bas. Ton PDF reste disponible ici.");
        else await send(chatId, "❌ Synchro impossible : " + (res.message || res.error) + ". Réessaie dans un moment.");
        return;
      }
      if (data === "rfc_pull") {
        if (!u.rfc) { await send(chatId, "Aucun compte lié pour le moment."); return; }
        const res = await rfc.listResumes(u.rfc.token);
        const items = res.ok ? (Array.isArray(res.data) ? res.data : (res.data.resumes || [])) : [];
        if (!res.ok) { await send(chatId, "❌ Je n'ai pas pu lire tes CV du site : " + (res.message || res.error)); return; }
        if (!items.length) { await send(chatId, "Aucun CV sur ton compte RealFreeCV pour le moment."); return; }
        await send(chatId, "⬇️ Quel CV veux-tu récupérer dans Baara ? (il remplacera ton CV actuel du bot)", items.slice(0, 6).map(it => [{ text: (it.title || "CV sans titre") + (it.updatedAt ? " · " + String(it.updatedAt).slice(0, 10) : ""), callback_data: "rfc_get_" + (it.appId || it.id) }]).concat([[{ text: "🏠 Menu", callback_data: "menu" }]])); return;
      }
      if (data.startsWith("rfc_get_")) {
        if (!u.rfc) return;
        const res = await rfc.getResume(u.rfc.token, data.slice(8));
        const rd = res.ok ? (res.data && (res.data.content || res.data)) : null;
        if (!rd || !rd.personal) { await send(chatId, "❌ Récupération impossible : " + ((res && res.message) || "format inattendu") + "."); return; }
        u.cvData = resumeToCv(rd); await store.upsertUser(u);
        const pdf = buildCvPdf(u.cvData, u.cvTemplate);
        await tg.sendDocument(chatId, pdf, "CV_" + (u.cvData.name || "Baara").replace(/\s+/g, "_") + ".pdf", "⬇️ Voici le CV récupéré depuis RealFreeCV — il est maintenant ton CV dans Baara.");
        return;
      }
      if (data === "rfc_unlink") { u.rfc = null; await store.upsertUser(u); await send(chatId, "🔓 Compte RealFreeCV délié côté Baara. Pense à révoquer aussi l'accès « Baara » dans Mon compte → Applications liées sur realfreecv.cv.", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
      if (data === "adm_pay") {
        if (!cfg.adminId || u.id !== cfg.adminId) return;
        const c = await getConfig(); const pend = c.orders.filter(o => o.status === "a_valider");
        if (!pend.length) { await send(chatId, "Aucun paiement en attente de validation."); return; }
        for (const o of pend.slice(0, 10)) await send(chatId, "💰 " + o.id + " — " + o.label + " — " + fmtF(o.total) + "\nClient : " + (o.userName || "") + " (id " + o.userId + ")\nPreuve : " + (o.proof ? o.proof.type : "—") + (o.proof && o.proof.value ? " — " + o.proof.value : ""), [[{ text: "✅ Valider — produire", callback_data: "admv_ok_" + o.id }, { text: "❌ Rejeter", callback_data: "admv_no_" + o.id }]]);
        return;
      }
      if (data.startsWith("admv_ok_")) { if (!cfg.adminId || u.id !== cfg.adminId) return; const found = await findOrder(data.slice(8)); if (found.order && found.order.status === "a_valider") { await send(chatId, "✅ Commande " + found.order.id + " validée — production lancée, le client reçoit ses documents."); await deliverOrder(found.order.id); } return; }
      if (data.startsWith("admv_no_")) { if (!cfg.adminId || u.id !== cfg.adminId) return; u.adminFlow = { type: "reject", orderId: data.slice(8) }; await store.upsertUser(u); await send(chatId, "Motif du rejet ? Il sera transmis au client (ses crédits éventuels lui sont rendus automatiquement)."); return; }
      if (data === "adm_stats") { if (!cfg.adminId || u.id !== cfg.adminId) return; await send(chatId, await statsText(), [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
      if (data === "adm_cast") { if (!cfg.adminId || u.id !== cfg.adminId) return; u.adminFlow = { type: "cast" }; await store.upsertUser(u); await send(chatId, "✍️ Écris le message à diffuser à tous les utilisateurs (il te sera redemandé en confirmation)."); return; }
      if (data === "adm_cast_go") { if (!cfg.adminId || u.id !== cfg.adminId) return; if (u.adminFlow && u.adminFlow.type === "cast_go" && u.adminFlow.text) { const users = (await store.listUsers()).filter(x => x.id !== 0); let n = 0; for (const x of users) { await tg.sendMessage(x.id, "📣 Message de Baara :\n\n" + u.adminFlow.text).catch(() => {}); n++; } u.adminFlow = null; await store.upsertUser(u); await send(chatId, "📣 Diffusion envoyée à " + n + " utilisateur(s)."); } return; }
      if (data === "adm_credit") { if (!cfg.adminId || u.id !== cfg.adminId) return; u.adminFlow = { type: "credit" }; await store.upsertUser(u); await send(chatId, "🎁 Gestion des crédits — envoie : identifiant montant (ex : 123456789 1000 ; montant négatif pour retirer)."); return; }
      if (data === "admin") {
        if (!cfg.adminId || u.id !== cfg.adminId) return;
        const users = await store.listUsers(); const real = users.filter(x => x.id !== 0);
        const cc = await getConfig();
        const pendN = cc.orders.filter(o => o.status === "a_valider").length;
        await send(chatId, "🛠️ Admin Baara\n• Utilisateurs : " + real.length + "\n• Avec CV : " + real.filter(x => x.cvData).length + "\n• Alertes actives : " + real.filter(x => x.alerts).length + "\n• Paiements à valider : " + pendN, [[{ text: "💰 Paiements à valider (" + pendN + ")", callback_data: "adm_pay" }, { text: "📊 Stats business", callback_data: "adm_stats" }], [{ text: "📣 Diffusion", callback_data: "adm_cast" }, { text: "🎁 Crédits", callback_data: "adm_credit" }], [{ text: "➕ Ajouter une offre", callback_data: "adm_add" }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data === "adm_add") { if (!cfg.adminId || u.id !== cfg.adminId) return; u.adminAdd = true; await store.upsertUser(u); await send(chatId, "Envoie l'offre au format :\nTitre | profil (emploi/concours/etudiant/entrepreneur) | AAAA-MM-JJ | Organisation | Résumé"); return; }
      return;
    }

    if (!msg) return;
    // --- Médias entrants (Lot B : zéro effort) ---
    if (msg.document || msg.photo || msg.voice) {
      // Preuve de paiement en attente : capture (photo ou image) transférée à l'admin, commande à valider
      if (u.buyFlow && u.buyFlow.step === "proof" && (msg.photo || (msg.document && /image/i.test(msg.document.mime_type || "")))) {
        const found = await findOrder(u.buyFlow.orderId);
        const order = found.order;
        if (order && order.userId === u.id && order.status === "attente_paiement") {
          order.status = "a_valider"; order.proof = { type: "capture" }; order.proofAt = new Date().toISOString(); await saveConfig(found.c);
          if (tg.forwardMessage) await tg.forwardMessage(cfg.adminId, chatId, msg.message_id).catch(() => {});
          const oid = order.id; u.buyFlow = null; await store.upsertUser(u);
          await send(chatId, "✅ Capture reçue ! Ta commande " + oid + " est en attente de validation. Dès que le paiement est confirmé, tes documents sont produits automatiquement ici.");
          await notifyAdminOrder(order, u);
        } else { u.buyFlow = null; await store.upsertUser(u); await send(chatId, "Cette commande n'attend plus de paiement."); }
        return;
      }
      if (u.buyFlow && u.buyFlow.step === "proof") { await send(chatId, "Pour la preuve de paiement, envoie-moi la capture d'écran du transfert, ou le code de transaction en texte."); return; }
      if (!tg.downloadFile || !ai.aiAvailable()) { await send(chatId, "Je ne peux pas encore lire les fichiers et vocaux (le module IA n'est pas branché). En attendant : crée ton CV avec le bouton « Mon CV », ou colle le texte de l'annonce pour la vérification anti-arnaque.", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
      try {
        if (msg.document && /pdf/i.test(msg.document.mime_type || "pdf")) {
          await send(chatId, "📄 Je lis ton CV…");
          const buf = await tg.downloadFile(msg.document.file_id);
          if (!buf) throw new Error("fichier illisible");
          const extractPrompt = "Extrais ce CV en JSON strict avec exactement ces clés : name, title, contact, city, summary, experiences (texte libre, une expérience par ligne), formations (texte libre), skills (séparées par des virgules), languages (texte libre). Valeurs en français, courtes, sans markdown, JSON uniquement.";
          let raw = await ai.aiMedia(buf.toString("base64"), "application/pdf", extractPrompt, 4000);
          let d = ai.parseJsonLoose(raw);
          if (!d || !d.name) { raw = await ai.aiMedia(buf.toString("base64"), "application/pdf", extractPrompt + " Réponse très compacte : limite chaque valeur à 200 caractères.", 4000); d = ai.parseJsonLoose(raw); }
          if (!d || !d.name) { console.error("Baara CV: extraction sans résultat, longueur brute =", raw ? raw.length : 0); throw new Error("extraction vide"); }
          const skills = String(d.skills || "").split(",").map(x => x.trim()).filter(Boolean);
          u.cvData = { name: d.name, title: d.title || "", contact: d.contact || "", city: d.city || "", summary: d.summary || "", expRaw: d.experiences || "", eduRaw: d.formations || "", skills, skillsRaw: d.skills || "", langRaw: d.languages || "" };
          await store.upsertUser(u);
          const pdf = buildCvPdf(u.cvData, u.cvTemplate);
          await tg.sendDocument(chatId, pdf, "CV_" + (u.cvData.name || "Baara").replace(/\s+/g, "_") + ".pdf", "✅ CV lu et enregistré ! J'ai rempli ton profil tout seul : " + u.cvData.name + (u.cvData.title ? " — " + u.cvData.title : "") + ". Vérifie le PDF : si quelque chose manque, refais-le via Mon CV.");
          if (u.rfc) { const sp = await syncPush(u); if (sp.ok) await send(chatId, "🔗 CV synchronisé sur ton compte RealFreeCV."); }
          await showMenu(u, chatId); return;
        }
        if (msg.photo) {
          await send(chatId, "📸 Je lis cette image…");
          const photo = msg.photo[msg.photo.length - 1];
          const buf = await tg.downloadFile(photo.file_id);
          if (!buf) throw new Error("image illisible");
          const raw = await ai.aiMedia(buf.toString("base64"), "image/jpeg", "Transcris intégralement le texte visible sur cette image (annonce, affiche ou message). S'il n'y a pas de texte, décris l'image en une phrase en français.", 900);
          if (!raw) throw new Error("lecture vide");
          const r = analyzeOffer(raw);
          let out = "📸 Voici ce que je lis sur l'image :\n\n" + raw.slice(0, 900) + "\n\n🛡️ Analyse anti-arnaque — risque : " + r.score + "/100\n" + r.verdict;
          if (r.signals.length) { out += "\nSignaux :"; for (const sg of r.signals) out += "\n• " + sg.label; }
          u.lastScamContacts = extractContacts(raw); await store.upsertUser(u);
          await send(chatId, out, [[{ text: "🚨 Signaler ces contacts", callback_data: "report_x" }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return;
        }
        if (msg.voice) {
          const dur = msg.voice.duration || 0;
          if (dur > 60) { await startBuy(u, chatId, "transcription", { fileId: msg.voice.file_id, durationSec: dur }); return; }
          const buf = await tg.downloadFile(msg.voice.file_id);
          if (!buf) throw new Error("vocal illisible");
          const raw = await ai.aiMedia(buf.toString("base64"), "audio/ogg", "Transcris fidèlement ce message vocal en français. Ne rends que la transcription.", 600);
          if (!raw) throw new Error("transcription vide");
          await send(chatId, "🎙️ J'ai compris : « " + raw.slice(0, 300) + " »");
          await handleUpdate({ message: { chat: { id: chatId }, from, text: raw } });
          return;
        }
      } catch (e) { await send(chatId, "Je n'ai pas réussi à lire ce fichier. Réessaie, ou utilise les boutons du menu.", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
    }
    // Interruption prioritaire : /start, /menu ou « menu » sortent de TOUT flux en cours
    if (/^\/(start|menu)\b/i.test(text || "") || normText(text || "") === "menu") {
      u.cvFlow = null; u.detFlow = null; u.prepFlow = null; u.scamFlow = false; u.adminAdd = false; u.buyFlow = null; u.adminFlow = null; u.linkFlow = false;
      await store.upsertUser(u);
    }
    // Flux admin (rejet motivé, diffusion, crédits)
    if (u.adminFlow && cfg.adminId && u.id === cfg.adminId && msg.text) {
      const af = u.adminFlow; u.adminFlow = null;
      if (af.type === "reject") {
        const found = await findOrder(af.orderId); const order = found.order;
        if (order && order.status === "a_valider") {
          order.status = "rejete"; order.rejectReason = text.trim().slice(0, 300); await saveConfig(found.c);
          const client = await store.getUser(order.userId).catch(() => null);
          if (client && order.creditUsed) { client.credit = (client.credit || 0) + order.creditUsed; await store.upsertUser(client); }
          await store.upsertUser(u);
          if (client) await tg.sendMessage(client.id, "❌ Ta commande " + order.id + " (" + order.label + ") n'a pas pu être validée.\nMotif : " + order.rejectReason + "\n" + (order.creditUsed ? "Tes crédits utilisés (" + fmtF(order.creditUsed) + ") t'ont été rendus. " : "") + "Si tu as bien payé, renvoie une capture plus lisible ou contacte le vendeur — aucun argent perdu sans vérification.").catch(() => {});
          await send(chatId, "Commande " + order.id + " rejetée, client informé.");
        } else { await store.upsertUser(u); await send(chatId, "Cette commande n'est plus en attente de validation."); }
        return;
      }
      if (af.type === "cast") { u.adminFlow = { type: "cast_go", text: text.trim().slice(0, 1500) }; await store.upsertUser(u); await send(chatId, "📣 Aperçu de la diffusion :\n\n" + u.adminFlow.text, [[{ text: "✅ Envoyer à tous", callback_data: "adm_cast_go" }], [{ text: "❌ Annuler", callback_data: "menu" }]]); return; }
      if (af.type === "credit") {
        const parts = text.trim().split(/\s+/); const targetId = Number(parts[0]); const amount = Number(parts[1]);
        await store.upsertUser(u);
        if (targetId && Number.isFinite(amount) && amount !== 0) {
          const target = await store.getUser(targetId).catch(() => null);
          if (target) { target.credit = Math.max(0, (target.credit || 0) + amount); await store.upsertUser(target); await send(chatId, "🎁 Crédits de l'utilisateur " + targetId + " : " + fmtF(target.credit) + "."); await tg.sendMessage(targetId, "🎁 Ton solde de crédits Baara a été ajusté : " + fmtF(target.credit) + ". Utilisables sur tous les services Premium.").catch(() => {}); }
          else await send(chatId, "Utilisateur introuvable : " + targetId);
        } else await send(chatId, "Format non reconnu. Attendu : identifiant montant (ex : 123456789 1000).");
        return;
      }
      await store.upsertUser(u); return;
    }
    // Flux commerce : preuve en texte, poste visé, questionnaire document
    if (u.buyFlow && msg.text) {
      const bf = u.buyFlow;
      if (bf.step === "proof" && !text.startsWith("/")) {
        const found = await findOrder(bf.orderId); const order = found.order;
        if (order && order.userId === u.id && order.status === "attente_paiement") {
          order.status = "a_valider"; order.proof = { type: "code", value: text.trim().slice(0, 120) }; order.proofAt = new Date().toISOString(); await saveConfig(found.c);
          u.buyFlow = null; await store.upsertUser(u);
          await send(chatId, "✅ Code reçu ! Ta commande " + order.id + " est en attente de validation. Tes documents sont produits dès la confirmation du paiement.");
          await notifyAdminOrder(order, u);
        } else { u.buyFlow = null; await store.upsertUser(u); await send(chatId, "Cette commande n'attend plus de paiement."); }
        return;
      }
      if (bf.step === "collect" && bf.service === "cvpro") { bf.payload.target = text.trim().slice(0, 120); await recapBuy(u, chatId); return; }
      if (bf.step === "doc_objet") { bf.payload.doc = bf.payload.doc || {}; bf.payload.doc.objet = text.trim().slice(0, 200); bf.step = "doc_dest"; await store.upsertUser(u); await send(chatId, "👤 À qui le document est-il destiné ? (nom et/ou fonction, ex : « Le Directeur de l'ONG Espoir Sahel »)"); return; }
      if (bf.step === "doc_dest") { bf.payload.doc.destinataire = text.trim().slice(0, 200); bf.step = "doc_points"; await store.upsertUser(u); await send(chatId, "🧩 Quels points le document doit-il couvrir ? (les faits, chiffres, demandes — en quelques lignes)"); return; }
      if (bf.step === "doc_points") { bf.payload.doc.points = text.trim().slice(0, 1200); await recapBuy(u, chatId); return; }
    }
    // Flux liaison RealFreeCV : code de liaison
    if (u.linkFlow && msg.text) {
      const code = text.trim().toUpperCase(); u.linkFlow = false;
      if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code)) { await store.upsertUser(u); await send(chatId, "Ce code ne ressemble pas à un code de liaison (8 caractères, sans 0 ni O). Régénère un code sur realfreecv.cv et retouche « J'ai mon code »."); return; }
      const res = await rfc.exchange(code);
      if (!res.ok || !res.data || !res.data.userToken) { await store.upsertUser(u); await send(chatId, "❌ Liaison impossible : " + ((res && res.message) || "code refusé") + ". Vérifie que le code est récent (30 minutes) et réessaie."); return; }
      const usr = res.data.user || {};
      u.rfc = { token: res.data.userToken, label: usr.email || usr.name || usr.displayName || "compte RealFreeCV", linkedAt: new Date().toISOString(), lastSyncAt: null, lastError: null };
      await store.upsertUser(u);
      await send(chatId, "✅ Compte RealFreeCV lié : " + u.rfc.label + "\n\nDésormais, tes CV créés ou achetés dans Baara sont aussi déposés sur ton compte du site.");
      if (u.cvData) { const sp = await syncPush(u); await send(chatId, sp.ok ? "🔗 Ton CV actuel vient d'être synchronisé sur RealFreeCV." : "⚠️ Première synchro en échec (" + (sp.error || "") + ") — retente via 🔗 RealFreeCV → Synchroniser."); }
      return;
    }
    // Flux profil détaille (onboarding)
    if (u.detFlow) {
      const step = DET_STEPS[u.detFlow.step];
      const val = /^passer$/i.test((msg.text || "").trim()) ? "" : (msg.text || "").trim();
      u.detFlow.data[step.key] = val;
      u.detFlow.step++;
      if (u.detFlow.step >= DET_STEPS.length) {
        u.details = u.detFlow.data; u.detFlow = null; await store.upsertUser(u);
        await send(chatId, "🎉 Bienvenue sur Baara, " + (u.firstName || "") + " ! Ton profil est complet — je classerai les offres selon ton match.\nBaara surveille pour toi les offres et concours du Mali, crée ton CV en PDF, l'adapte à chaque offre, génère ta lettre de motivation, te prépare aux entretiens et repère les arnaques.");
        await showMenu(u, chatId);
      } else { await store.upsertUser(u); await send(chatId, DET_STEPS[u.detFlow.step].prompt); }
      return;
    }
    // Flux simulation d'entretien : reponse a une question
    if (u.prepFlow && msg.text) {
      if (/^stop$/i.test(msg.text.trim())) { u.prepFlow = null; await store.upsertUser(u); await send(chatId, "Simulation arrêtée. Tu pourras la relancer depuis la fiche de l'offre.", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
      const pf = u.prepFlow;
      let feedback = "Merci pour cette réponse. Pense à donner un exemple concret et chiffré quand c'est possible — c'est ce qui convainc.";
      if (ai.aiAvailable()) {
        const fb = pf.premium
          ? await ai.aiText("Tu es un coach d'entretien exigeant et précis. Question posée : « " + pf.qs[pf.step] + " » (poste : " + pf.title + "). Réponse du candidat : « " + msg.text.slice(0, 700) + " ». Donne une correction détaillée en français (6 phrases maximum, sans markdown) : une note sur 10, les points forts, les points faibles, et un exemple de formulation améliorée.", 600)
          : await ai.aiText("Tu es un coach d'entretien bienveillant. Question posée : « " + pf.qs[pf.step] + " » (poste : " + pf.title + "). Réponse du candidat : « " + msg.text.slice(0, 600) + " ». Donne un retour court en français (3 phrases maximum) : un point fort, un point à améliorer, sans markdown.", 300);
        if (fb) feedback = fb.replace(/\s+/g, " ").trim();
      }
      pf.step++;
      if (pf.step >= pf.qs.length) { u.prepFlow = null; await store.upsertUser(u);
        if (pf.premium) await send(chatId, "💬 Ma correction : " + feedback + "\n\n🏁 Simulation PREMIUM terminée — " + pf.qs.length + " questions corrigées en détail. Bilan : travaille tes exemples chiffrés, structure chaque réponse (situation → action → résultat), et prépare deux questions à poser au recruteur. Tu es prêt. Bonne chance !", [[{ text: "🏠 Menu", callback_data: "menu" }]]);
        else await send(chatId, "💬 Mon retour : " + feedback + "\n\n🏁 Simulation gratuite terminée — " + pf.qs.length + " questions. ⭐ La version Premium (" + fmtF(SERVICES.entretien.price) + ") : 6 questions adaptées à l'offre + correction détaillée de chaque réponse (note /10, points faibles, meilleure formulation) + bilan complet.", [[{ text: "⭐ Passer en Entretien Premium", callback_data: "svco_entretien_" + pf.offerId }], [{ text: "🏠 Menu", callback_data: "menu" }]]);
      }
      else { await store.upsertUser(u); await send(chatId, "💬 Mon retour : " + feedback + "\n\nQuestion " + (pf.step + 1) + "/" + pf.qs.length + " : " + pf.qs[pf.step]); }
      return;
    }
    // Flux admin : ajout d'offre
    if (u.adminAdd && cfg.adminId && u.id === cfg.adminId) {
      u.adminAdd = false;
      const parts = text.split("|").map(s => s.trim());
      if (parts.length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(parts[2])) {
        const c = await getConfig();
        const id = "adm-" + Date.now().toString(36);
        c.customOpps.push({ id, title: parts[0], profile: ["emploi", "concours", "etudiant", "entrepreneur"].includes(parts[1]) ? parts[1] : "emploi", deadlineISO: parts[2], deadline: parts[2], org: parts[3], summary: parts.slice(4).join(" | ") });
        await saveConfig(c); await store.upsertUser(u);
        await send(chatId, "✅ Offre ajoutée au Radar : " + parts[0]);
      } else { await store.upsertUser(u); await send(chatId, "Format non reconnu — offre non ajoutée. Format : Titre | profil | AAAA-MM-JJ | Organisation | Résumé"); }
      return;
    }
    // Flux CV
    if (u.cvFlow) {
      const step = CV_STEPS[u.cvFlow.step];
      const val = /^passer$/i.test(text.trim()) ? "" : text.trim();
      u.cvFlow.data[step.key] = val;
      u.cvFlow.step++;
      if (u.cvFlow.step >= CV_STEPS.length) { await finishCv(u, chatId); }
      else { await store.upsertUser(u); await send(chatId, CV_STEPS[u.cvFlow.step].prompt); }
      return;
    }
    // Flux anti-arnaque
    if (u.scamFlow) {
      u.scamFlow = false; await store.upsertUser(u);
      if (text.length < 30) { await send(chatId, "Ce texte est trop court pour être analysé. Colle l'annonce ou le message complet.", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
      const r = analyzeOffer(text);
      const contacts = extractContacts(text);
      u.lastScamContacts = contacts; await store.upsertUser(u);
      const c = await getConfig();
      const reported = contacts.map(ct => ({ ct, n: c.scamReports[ct] || 0 })).filter(x => x.n > 0);
      let out = "🛡️ Analyse de l'offre reçue — score de risque : " + r.score + "/100\n\n" + r.verdict;
      if (r.signals.length) { out += "\n\nSignaux repérés :"; for (const s of r.signals) out += "\n• " + s.label; }
      if (reported.length) out += "\n\n👥 Communauté Baara : " + reported.map(x => x.ct + " (signalé " + x.n + " fois)").join(", ") + " — méfiance renforcée.";
      out += "\n\n🔑 Règles d'or : un vrai recrutement ne demande JAMAIS d'argent ; postule via le site ou l'e-mail officiel de l'organisation ; en cas de doute, appelle l'organisation au numéro de son site officiel.";
      const kb = [[{ text: "🏠 Menu", callback_data: "menu" }]];
      if (contacts.length) kb.unshift([{ text: "🚨 Signaler ces contacts à la communauté", callback_data: "report_x" }]);
      await send(chatId, out, kb);
      if (ai.aiAvailable()) {
        const avis = await ai.aiText("Tu es un expert des arnaques au recrutement en Afrique de l'Ouest. Analyse ce message d'offre d'emploi en français (4 phrases maximum, sans markdown) : verdict clair (probablement légitime / douteux / probablement une arnaque), les 2 indices principaux, et le geste de vérification recommandé. Message : " + text.slice(0, 1500), 400);
        if (avis) await send(chatId, "🤖 Deuxième avis (IA) :\n\n" + avis.replace(/\s+/g, " ").trim());
      }
      return;
    }
    // Commandes et intentions
    const lt = normText(text);
    if (ai.aiAvailable() && text.length >= 12 && !text.startsWith("/")) {
      const parsed = ai.parseJsonLoose(await ai.aiText("Extrais l'intention de recherche d'emploi de ce message en JSON strict {\"ville\": \"\", \"secteur\": \"\", \"type\": \"emploi|concours|stage|\"}. Message : " + text.slice(0, 300), 200));
      if (parsed && (parsed.ville || parsed.secteur || parsed.type)) {
        const offers = await allOffers();
        const wanted = keywords((parsed.secteur || "") + " " + (parsed.type === "stage" ? "stage stagiaire" : parsed.type || ""), 8);
        const inCity = (o) => !parsed.ville || normText(o.title + " " + (o.summary || "")).includes(normText(parsed.ville).split(" ")[0]);
        const hits = offers.filter(o => inCity(o) && (!wanted.length || wanted.some(k => normText(o.title + " " + (o.summary || "")).includes(k)) || (parsed.type === "concours" && o.profile === "concours" && inCity(o))));
        if (hits.length) {
          let t2 = "🤖 J'ai compris : tu cherches" + (parsed.type ? " (" + parsed.type + ")" : "") + (parsed.secteur ? " dans « " + parsed.secteur + " »" : "") + (parsed.ville ? " à " + parsed.ville : "") + ". Voici ce qui correspond :";
          const kb = [];
          for (const o of hits.slice(0, 5)) { t2 += "\n\n• " + o.title + "\n  🏢 " + (o.org || "") + " — ⏰ " + (o.deadline || o.deadlineISO); kb.push([{ text: "🎯 CV adapté — " + o.title.slice(0, 32) + "…", callback_data: "tailor_" + o.id }]); }
          kb.push([{ text: "📋 Toutes les offres", callback_data: "radar_all" }, { text: "🏠 Menu", callback_data: "menu" }]);
          await send(chatId, t2, kb); return;
        }
        await send(chatId, "🤖 J'ai compris ta recherche" + (parsed.secteur ? " (« " + parsed.secteur + " »" : "") + (parsed.ville ? " à " + parsed.ville + ")" : parsed.secteur ? ")" : "") + ", mais aucune offre active ne correspond pour le moment. Je te préviendrai dès qu'une offre de ton profil arrive — voici en attendant toutes les offres :", [[{ text: "🔎 Toutes les offres", callback_data: "radar_all" }]]); return;
      }
    }
    if (text.startsWith("/start") || text.startsWith("/menu") || lt === "menu") {
      u.cvFlow = null; u.scamFlow = false; u.detFlow = null; await store.upsertUser(u);
      if (!u.profile) { await send(chatId, "👋 Bienvenue sur Baara — ton assistant Emploi & CV du Mali.\n\nJe surveille les offres et concours, je crée ton CV en PDF, je l'adapte à chaque offre, et je t'aide à repérer les arnaques.\n\nD'abord, qui es-tu ?", PROFILES.map(p => [{ text: p.label, callback_data: "prof_" + p.id }])); return; }
      await send(chatId, "Content de te revoir, " + (u.firstName || "") + " 👋");
      await showMenu(u, chatId); return;
    }
    if (lt.includes("offre") || lt.includes("emploi") || lt.includes("concours") || lt.includes("radar")) { await showRadar(u, chatId, u.profile ? "mine" : "all", 0); return; }
    if (lt.includes("arnaque") || lt.includes("verifier") || lt.includes("fraude")) { u.scamFlow = true; await store.upsertUser(u); await send(chatId, "🛡️ Colle ici le texte complet de l'offre ou du message à vérifier."); return; }
    if (lt.includes("cv") || lt.includes("curriculum")) { await handleUpdate({ callback_query: { id: "x", from, message: { chat: { id: chatId } }, data: "cv_menu" } }); return; }
    await send(chatId, "Je suis Baara, ton assistant Emploi & CV. Voici ce que je sais faire :", mainMenu(u));
  }

  async function ingestOpps(raw) {
    const c = await getConfig();
    const before = new Set((await allOffers()).map(o => o.id));
    let added = 0;
    for (const o of raw) {
      if (!before.has(o.id) && !c.relayOpps.find(x => x.id === o.id)) { c.relayOpps.push(o); added++; }
    }
    c.relayOpps = c.relayOpps.filter(o => o.deadlineISO >= todayISO()).slice(-40);
    await saveConfig(c);
    // Alerte nouvelle offre aux profils concernés
    if (added) {
      const fresh = (await allOffers()).filter(o => !before.has(o.id));
      const users = (await store.listUsers()).filter(x => x.id !== 0 && x.alerts && x.profile);
      for (const usr of users) for (const o of fresh) {
        if (o.profile === usr.profile || o.profile === "concours") {
          await tg.sendMessage(usr.id, "🆕 Nouvelle offre pour toi :\n\n• " + o.title + "\n🏢 " + (o.org || "") + "\n⏰ Date limite : " + (o.deadline || o.deadlineISO), { reply_markup: { inline_keyboard: [[{ text: "🎯 CV adapté", callback_data: "tailor_" + o.id }], [{ text: "📋 Voir les offres", callback_data: "radar_mine" }]] } }).catch(() => {});
        }
      }
    }
    return { added, total: (await allOffers()).length };
  }

  async function housekeeping() {
    let alerts = 0;
    const offers = await allOffers();
    const users = (await store.listUsers()).filter(x => x.id !== 0 && x.alerts && x.profile);
    for (const usr of users) {
      let changed = false;
      for (const o of offers) {
        const d = daysLeft(o.deadlineISO);
        if (d < 0 || d > 3) continue;
        if (o.profile !== usr.profile && o.profile !== "concours") continue;
        if (usr.alerted[o.id] === todayISO()) continue;
        usr.alerted[o.id] = todayISO(); changed = true; alerts++;
        await tg.sendMessage(usr.id, "⏰ Plus que " + d + " jour(s) avant la date limite !\n\n• " + o.title + "\n🏢 " + (o.org || "") + "\nDate limite : " + (o.deadline || o.deadlineISO), { reply_markup: { inline_keyboard: [[{ text: "🎯 CV adapté", callback_data: "tailor_" + o.id }], [{ text: "📋 Voir les offres", callback_data: "radar_mine" }]] } }).catch(() => {});
      }
      if (changed) await store.upsertUser(usr);
    }
    // Récap du matin (vers 7h, heure de Bamako = UTC) + relances de candidatures à J+7
    let digests = 0, relances = 0;
    const hour = new Date().getUTCHours();
    for (const usr of users) {
      let changed = false;
      if (hour === 7 && usr.lastDigest !== todayISO() && usr.details) {
        const top = offers.map(o => ({ o, ms: matchScore(usr, o) })).filter(x => x.ms).sort((a, b) => b.ms.score - a.ms.score).slice(0, 3);
        if (top.length) {
          let t = "☀️ Bonjour " + (usr.firstName || "") + " ! Ton récap Baara du matin :";
          for (const x of top) t += "\n\n• " + x.o.title + "\n  🎯 Match " + x.ms.score + "% — ⏰ " + (x.o.deadline || x.o.deadlineISO);
          t += "\n\nBonne journée — les dossiers préparés tôt gagnent.";
          await tg.sendMessage(usr.id, t, { reply_markup: { inline_keyboard: [[{ text: "📋 Voir les offres", callback_data: "radar_mine" }], [{ text: "🎯 Question du jour", callback_data: "quiz_start" }]] } }).catch(() => {});
          usr.lastDigest = todayISO(); changed = true; digests++;
        }
      }
      for (const [oid, app] of Object.entries(usr.applications || {})) {
        const age = Math.round((new Date(todayISO() + "T12:00:00Z") - new Date(app.date + "T12:00:00Z")) / 86400000);
        if (age >= 7 && !app.reminded) {
          app.reminded = true; changed = true; relances++;
          await tg.sendMessage(usr.id, "📁 Relance candidature — ça fait 7 jours que tu as postulé à : " + app.title + " (" + (app.org || "") + ").\nSi tu n'as pas de réponse, un message court et poli de relance est bien vu : rappelle le poste, ta motivation en une phrase, et propose un entretien.", { reply_markup: { inline_keyboard: [[{ text: "📁 Mes candidatures", callback_data: "myapps" }]] } }).catch(() => {});
        }
      }
      if (changed) await store.upsertUser(usr);
    }
    // Commerce : relances des commandes non payées (2 h puis 24 h, jamais plus) + rapport admin à 7 h
    let rappels = 0;
    const cc = await getConfig(); let ccChanged = false;
    for (const o of cc.orders) {
      if (o.status !== "attente_paiement") continue;
      const ageH = (Date.now() - new Date(o.createdAt).getTime()) / 3600000;
      if (ageH >= 24 && !o.r24) { o.r24 = true; ccChanged = true; rappels++; await tg.sendMessage(o.userId, "⌛ Dernier rappel : ta commande " + o.id + " (" + o.label + " — " + fmtF(o.total) + ") attend toujours son paiement. Sans paiement elle restera en attente ; tu pourras recommander quand tu voudras.", { reply_markup: { inline_keyboard: [[{ text: "✅ J'ai payé", callback_data: "buy_paid_" + o.id }]] } }).catch(() => {}); }
      else if (ageH >= 2 && !o.r2) { o.r2 = true; ccChanged = true; rappels++; await tg.sendMessage(o.userId, "⏳ Petit rappel : ta commande " + o.id + " (" + o.label + ") attend son paiement de " + fmtF(o.total) + ". Dès la validation, tes documents sont produits automatiquement.", { reply_markup: { inline_keyboard: [[{ text: "✅ J'ai payé", callback_data: "buy_paid_" + o.id }]] } }).catch(() => {}); }
    }
    if (hour === 7 && cfg.adminId && cc.lastAdminReport !== todayISO()) {
      cc.lastAdminReport = todayISO(); ccChanged = true;
      await tg.sendMessage(cfg.adminId, await buildAdminReport()).catch(() => {});
    }
    if (ccChanged) await saveConfig(cc);
    return { alerts, digests, relances, rappels, offers: offers.length, users: users.length };
  }

  return { handleUpdate, ingestOpps, housekeeping, _commerce: { statsText, buildAdminReport } };
}
module.exports = { createBot, analyzeOffer };
