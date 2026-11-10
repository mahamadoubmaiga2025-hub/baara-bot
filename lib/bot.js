// Baara — bot Emploi & CV (Mali) : Radar d'offres vérifiées, CV PDF + CV adapté à l'offre,
// vérification anti-arnaque d'une offre reçue, alertes avant deadlines. Aucune boutique.
const { PROFILES, OPPORTUNITIES, QUIZ } = require("./data");
const { buildCvPdf } = require("./cv");
const { createPdf } = require("./pdf");
const ai = require("./ai");

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
  async function getConfig() {
    let c = await store.getUser(0);
    if (!c) { c = { id: 0, customOpps: [], relayOpps: [] }; await store.upsertUser(c); }
    if (!Array.isArray(c.customOpps)) c.customOpps = [];
    if (!Array.isArray(c.relayOpps)) c.relayOpps = [];
    if (!c.scamReports || typeof c.scamReports !== "object") c.scamReports = {};
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
    if (!u) { u = { id: from.id, firstName: from.first_name || "", profile: null, alerts: true, cvData: null, alerted: {}, tailorDay: "", tailorCount: 0, createdAt: todayISO(), details: null, detFlow: null, applications: {}, quiz: { streak: 0, lastDay: "", points: 0, answeredDay: "" }, lastDigest: "", prepFlow: null, lastScamContacts: [] }; await store.upsertUser(u); }
    if (!u.quiz) u.quiz = { streak: 0, lastDay: "", points: 0, answeredDay: "" };
    if (!u.applications) u.applications = {};
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
    const pdf = buildCvPdf(cv);
    await tg.sendDocument(chatId, pdf, "CV_" + (cv.name || "Baara").replace(/\s+/g, "_") + ".pdf", "✅ Voici ton CV. Il est sauvegardé dans le bot : tu pourras l'adapter à chaque offre en un toucher.\nPour une version encore plus poussée (modèles pro, score ATS) : RealFreeCV — realfreecv.cv");
    if (pending) { const offers = await allOffers(); const o = offers.find(x => x.id === pending); if (o) await tailorForOffer(u, chatId, o); }
  }
  async function tailorForOffer(u, chatId, offer) {
    if (!u.cvData) { await send(chatId, "Pour adapter ton CV à cette offre, je dois d'abord créer ton CV de base — ça prend 2 minutes."); await startCvFlow(u, chatId, offer.id); return; }
    if (u.tailorDay !== todayISO()) { u.tailorDay = todayISO(); u.tailorCount = 0; }
    if (u.tailorCount >= 3) { await send(chatId, "Tu as atteint la limite de 3 CV adaptés pour aujourd'hui. Reviens demain — tes chances méritent un CV frais, pas fatigué. 😊", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return; }
    u.tailorCount++; await store.upsertUser(u);
    const cv = u.cvData;
    const offerKw = keywords(offer.title + " " + (offer.summary || "") + " " + (offer.org || ""));
    const cvText = normText([cv.title, cv.summary, cv.expRaw, cv.eduRaw, cv.skillsRaw, (cv.skills || []).join(" ")].join(" "));
    const matched = offerKw.filter(k => cvText.includes(k));
    const missing = offerKw.filter(k => !cvText.includes(k));
    const score = offerKw.length ? Math.round(100 * matched.length / offerKw.length) : 0;
    await send(chatId, "🎯 Adaptation à : " + offer.title + "\n🏢 " + (offer.org || "") + "\n\n📊 Score d'adéquation de ton CV actuel : " + score + "/100" +
      (matched.length ? "\n✅ Mots-clés de l'offre présents dans ton CV : " + matched.slice(0, 8).join(", ") : "") +
      (missing.length ? "\n⚠️ Absents de ton CV : " + missing.slice(0, 8).join(", ") + "\nSi certains te correspondent VRAIMENT, ajoute-les dans ton CV (bouton Mon CV → refaire). N'ajoute jamais un mot-clé qui ne te correspond pas : les recruteurs le détectent en entretien." : "\nTon CV couvre tous les mots-clés repérés dans l'offre."));
    let adaptedSummary = "Candidature pour : " + offer.title + " (" + (offer.org || "") + ")." + (matched.length ? " Points forts en lien direct avec l'offre : " + matched.slice(0, 6).join(", ") + "." : "") + (cv.summary ? " " + cv.summary : "");
    if (ai.aiAvailable()) {
      const aiSummary = await ai.aiText("Réécris en français le résumé de profil (3 phrases maximum, ton professionnel, première personne, sans inventer aucune expérience ni diplôme) de ce CV pour l'adapter à l'offre visée. CV : poste visé " + cv.title + ", compétences " + (cv.skillsRaw || "") + ", expériences " + (cv.expRaw || "") + ", formations " + (cv.eduRaw || "") + ", résumé actuel " + (cv.summary || "") + ". Offre : " + offer.title + " chez " + (offer.org || "") + " — " + (offer.summary || ""), 350);
      if (aiSummary && aiSummary.length > 30) adaptedSummary = aiSummary.replace(/\s+/g, " ").trim();
    }
    const adapted = Object.assign({}, cv, { title: offer.title.slice(0, 60), summary: adaptedSummary });
    const pdf = buildCvPdf(adapted);
    await tg.sendDocument(chatId, pdf, "CV_adapte_" + offer.id + ".pdf", "📄 Voici ton CV adapté à cette offre. Bonne chance — et n'attends pas la date limite (" + (offer.deadline || offer.deadlineISO) + ") pour postuler.");
  }

  async function handleUpdate(upd) {
    const msg = upd.message; const cb = upd.callback_query;
    const chatId = msg ? msg.chat.id : cb ? cb.message.chat.id : null;
    const from = msg ? msg.from : cb ? cb.from : null;
    if (!chatId || !from) return;
    if (cb) await tg.answerCallbackQuery(cb.id).catch(() => {});
    const u = await ensureUser(from);
    const data = cb ? cb.data : null;
    const text = msg ? (msg.text || "") : "";

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
      if (data === "myprofile") { await send(chatId, "👤 Ton profil\n• Nom : " + (u.firstName || "—") + "\n• Catégorie : " + (u.profile ? profileLabel(u.profile) : "non choisie") + "\n• Alertes deadlines : " + (u.alerts ? "activées" : "coupées") + "\n• CV enregistré : " + (u.cvData ? "oui (" + (u.cvData.title || "sans poste visé") + ")" : "non"), [[{ text: "Changer de catégorie", callback_data: "change_profile" }, { text: "🏠 Menu", callback_data: "menu" }]]); return; }
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
        if (u.cvData) await send(chatId, "📄 Ton CV enregistré vise : " + (u.cvData.title || "—") + ".\nTu peux le recevoir à nouveau en PDF, ou le refaire entièrement.", [[{ text: "📥 Recevoir mon CV en PDF", callback_data: "cv_send" }], [{ text: "♻️ Refaire mon CV", callback_data: "cv_start" }], [{ text: "🏠 Menu", callback_data: "menu" }]]);
        else await send(chatId, "Tu n'as pas encore de CV dans Baara. Je te le crée en 8 questions, puis je pourrai l'adapter à chaque offre.", [[{ text: "✍️ Créer mon CV", callback_data: "cv_start" }], [{ text: "🏠 Menu", callback_data: "menu" }]]);
        return;
      }
      if (data === "cv_start") { await startCvFlow(u, chatId, null); return; }
      if (data === "cv_send") { const pdf = buildCvPdf(u.cvData); await tg.sendDocument(chatId, pdf, "CV_" + (u.cvData.name || "Baara").replace(/\s+/g, "_") + ".pdf", "📄 Voici ton CV."); return; }
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
        const cv = u.cvData;
        await send(chatId, "✉️ Je rédige ta lettre de motivation pour cette offre…");
        let letter = ai.aiAvailable() ? await ai.aiText("Rédige une lettre de motivation formelle en français (250 mots maximum, 4 paragraphes, pas de markdown) pour ce candidat. Candidat : " + cv.name + ", poste actuel/visé : " + cv.title + ", compétences : " + (cv.skillsRaw || "") + ", expériences : " + (cv.expRaw || "") + ", formations : " + (cv.eduRaw || "") + ", ville : " + (cv.city || "") + ", contact : " + (cv.contact || "") + ". Offre : " + o.title + " chez " + (o.org || "") + ". " + (o.summary || "") + " Termine par la formule de politesse et le nom du candidat (sans crochets ni champs à remplir).", 800) : null;
        if (!letter) {
          letter = (cv.city || "Bamako") + ", le " + new Date().toLocaleDateString("fr-FR") + "\n\nObjet : Candidature au poste — " + o.title + "\n\nMadame, Monsieur,\n\nPar la présente, je vous soumets ma candidature au poste indiqué en objet au sein de " + (o.org || "votre organisation") + ". " + (cv.title ? "Fort d'un profil de " + cv.title + ", " : "") + "je suis convaincu de pouvoir contribuer efficacement à vos missions.\n\nMes compétences — " + (cv.skillsRaw || "à détailler") + " — ainsi que mon expérience — " + (cv.expRaw || "à détailler") + " — correspondent aux exigences de cette offre. Rigoureux et motivé, je reste disponible pour un entretien à votre convenance.\n\nDans l'attente de votre retour, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n" + cv.name + "\n" + (cv.contact || "");
        }
        const blocks = String(letter).split(/\n+/).filter(Boolean).map(t => ({ text: t, size: 11, spaceBefore: 6 }));
        const pdf = createPdf(blocks, { footer: (i, n) => cv.name + " — Lettre de motivation · Page " + i + "/" + n + " · Baara × RealFreeCV" });
        await tg.sendDocument(chatId, pdf, "Lettre_" + o.id + ".pdf", "✉️ Voici ta lettre de motivation pour : " + o.title + "\nRelis-la et personnalise au moins une phrase avec un fait précis sur l'organisation — c'est ce qui te distinguera.");
        return;
      }
      if (data.startsWith("prep_")) {
        const offers = await allOffers(); const o = offers.find(x => x.id === data.slice(5));
        if (!o) { await send(chatId, "Cette offre n'est plus active."); return; }
        await send(chatId, "🎤 Je prépare ta simulation d'entretien pour : " + o.title + "…");
        let qs = null;
        if (ai.aiAvailable()) {
          const raw = await ai.aiText("Donne exactement 5 questions d'entretien probables (une par ligne, sans numérotation) pour le poste : " + o.title + " chez " + (o.org || "") + ". Contexte de l'offre : " + (o.summary || "") + ". Questions en français, concrètes, du plus simple au plus technique.", 500);
          if (raw) qs = raw.split(/\n+/).map(x => x.replace(/^\d+[.)]\s*/, "").trim()).filter(x => x.length > 8).slice(0, 5);
        }
        if (!qs || qs.length < 3) qs = ["Présentez-vous en deux minutes.", "Pourquoi voulez-vous ce poste chez " + (o.org || "cette organisation") + " ?", "Quelle est votre plus grande réussite professionnelle ou scolaire ?", "Comment gérez-vous une difficulté ou un désaccord au travail ?", "Avez-vous des questions pour nous ? (préparez-en deux)"];
        u.prepFlow = { offerId: o.id, title: o.title, qs, step: 0 };
        await store.upsertUser(u);
        await send(chatId, "🎤 Simulation d'entretien — " + o.title + "\nRéponds à chaque question comme en vrai entretien ; je te fais un retour court après chacune. (Écris « stop » pour arrêter.)\n\nQuestion 1/" + qs.length + " : " + qs[0]);
        return;
      }
      if (data.startsWith("report_")) {
        const contacts = u.lastScamContacts || [];
        if (!contacts.length) { await send(chatId, "Aucun contact à signaler sur la dernière analyse."); return; }
        const c = await getConfig();
        for (const ct of contacts) c.scamReports[ct] = (c.scamReports[ct] || 0) + 1;
        await saveConfig(c);
        await send(chatId, "🚨 Merci. Ces contacts sont maintenant signalés dans Baara : " + contacts.join(", ") + ". Si d'autres utilisateurs reçoivent une offre venant d'eux, ils seront prévenus.", [[{ text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data === "admin") {
        if (!cfg.adminId || u.id !== cfg.adminId) return;
        const users = await store.listUsers(); const real = users.filter(x => x.id !== 0);
        await send(chatId, "🛠️ Admin Baara\n• Utilisateurs : " + real.length + "\n• Avec CV : " + real.filter(x => x.cvData).length + "\n• Alertes actives : " + real.filter(x => x.alerts).length, [[{ text: "➕ Ajouter une offre", callback_data: "adm_add" }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data === "adm_add") { if (!cfg.adminId || u.id !== cfg.adminId) return; u.adminAdd = true; await store.upsertUser(u); await send(chatId, "Envoie l'offre au format :\nTitre | profil (emploi/concours/etudiant/entrepreneur) | AAAA-MM-JJ | Organisation | Résumé"); return; }
      return;
    }

    if (!msg) return;
    // --- Médias entrants (Lot B : zéro effort) ---
    if (msg.document || msg.photo || msg.voice) {
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
          const pdf = buildCvPdf(u.cvData);
          await tg.sendDocument(chatId, pdf, "CV_" + (u.cvData.name || "Baara").replace(/\s+/g, "_") + ".pdf", "✅ CV lu et enregistré ! J'ai rempli ton profil tout seul : " + u.cvData.name + (u.cvData.title ? " — " + u.cvData.title : "") + ". Vérifie le PDF : si quelque chose manque, refais-le via Mon CV.");
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
      u.cvFlow = null; u.detFlow = null; u.prepFlow = null; u.scamFlow = false; u.adminAdd = false;
      await store.upsertUser(u);
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
        const fb = await ai.aiText("Tu es un coach d'entretien bienveillant. Question posée : « " + pf.qs[pf.step] + " » (poste : " + pf.title + "). Réponse du candidat : « " + msg.text.slice(0, 600) + " ». Donne un retour court en français (3 phrases maximum) : un point fort, un point à améliorer, sans markdown.", 300);
        if (fb) feedback = fb.replace(/\s+/g, " ").trim();
      }
      pf.step++;
      if (pf.step >= pf.qs.length) { u.prepFlow = null; await store.upsertUser(u); await send(chatId, "💬 Mon retour : " + feedback + "\n\n🏁 Simulation terminée — " + pf.qs.length + " questions traitées. Retiens : exemples concrets, réponses de 1 à 2 minutes, et deux questions à poser à la fin. Bonne chance !", [[{ text: "🏠 Menu", callback_data: "menu" }]]); }
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
    return { alerts, digests, relances, offers: offers.length, users: users.length };
  }

  return { handleUpdate, ingestOpps, housekeeping };
}
module.exports = { createBot, analyzeOffer };
