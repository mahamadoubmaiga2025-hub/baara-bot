// Baara — bot Emploi & CV (Mali) : Radar d'offres vérifiées, CV PDF + CV adapté à l'offre,
// vérification anti-arnaque d'une offre reçue, alertes avant deadlines. Aucune boutique.
const { PROFILES, OPPORTUNITIES } = require("./data");
const { buildCvPdf } = require("./cv");

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
    if (!u) { u = { id: from.id, firstName: from.first_name || "", profile: null, alerts: true, cvData: null, alerted: {}, tailorDay: "", tailorCount: 0, createdAt: todayISO() }; await store.upsertUser(u); }
    return u;
  }
  const send = (chatId, text, kb) => tg.sendMessage(chatId, text, kb ? { reply_markup: { inline_keyboard: kb } } : undefined);
  function mainMenu(u) {
    const kb = [
      [{ text: "📋 Offres pour moi", callback_data: "radar_mine" }, { text: "🔎 Toutes les offres", callback_data: "radar_all" }],
      [{ text: "📄 Mon CV", callback_data: "cv_menu" }, { text: "🛡️ Vérifier une offre", callback_data: "scam_start" }],
      [{ text: u.alerts ? "🔔 Alertes : OUI" : "🔕 Alertes : NON", callback_data: "alerts_toggle" }, { text: "👤 Mon profil", callback_data: "myprofile" }],
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
      text += "\n• " + o.title + "\n  🏢 " + (o.org || "") + " — ⏰ " + (o.deadline || o.deadlineISO) + (d <= 3 ? " — ⚠️ plus que " + d + " j !" : "") + "\n";
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
    u.scamFlow = false; await store.upsertUser(u);
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
    const adapted = Object.assign({}, cv, {
      title: offer.title.slice(0, 60),
      summary: "Candidature pour : " + offer.title + " (" + (offer.org || "") + ")." + (matched.length ? " Points forts en lien direct avec l'offre : " + matched.slice(0, 6).join(", ") + "." : "") + (cv.summary ? " " + cv.summary : ""),
    });
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
        u.profile = data.slice(5); await store.upsertUser(u);
        await send(chatId, "✅ Profil enregistré : " + profileLabel(u.profile) + "\n\n🎉 Bienvenue sur Baara, " + (u.firstName || "") + " !\nBaara surveille pour toi les offres d'emploi et concours du Mali, crée ton CV en PDF et l'adapte à chaque offre, et t'aide à repérer les arnaques de recrutement.");
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
        await send(chatId, "📄 " + o.title + "\n🏢 " + (o.org || "") + "\n⏰ Date limite : " + (o.deadline || o.deadlineISO) + "\n\n" + (o.summary || ""), [[{ text: "🎯 CV adapté à cette offre", callback_data: "tailor_" + o.id }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return;
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
      if (data === "admin") {
        if (!cfg.adminId || u.id !== cfg.adminId) return;
        const users = await store.listUsers(); const real = users.filter(x => x.id !== 0);
        await send(chatId, "🛠️ Admin Baara\n• Utilisateurs : " + real.length + "\n• Avec CV : " + real.filter(x => x.cvData).length + "\n• Alertes actives : " + real.filter(x => x.alerts).length, [[{ text: "➕ Ajouter une offre", callback_data: "adm_add" }], [{ text: "🏠 Menu", callback_data: "menu" }]]); return;
      }
      if (data === "adm_add") { if (!cfg.adminId || u.id !== cfg.adminId) return; u.adminAdd = true; await store.upsertUser(u); await send(chatId, "Envoie l'offre au format :\nTitre | profil (emploi/concours/etudiant/entrepreneur) | AAAA-MM-JJ | Organisation | Résumé"); return; }
      return;
    }

    if (!msg) return;
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
      let out = "🛡️ Analyse de l'offre reçue — score de risque : " + r.score + "/100\n\n" + r.verdict;
      if (r.signals.length) { out += "\n\nSignaux repérés :"; for (const s of r.signals) out += "\n• " + s.label; }
      out += "\n\n🔑 Règles d'or : un vrai recrutement ne demande JAMAIS d'argent ; postule via le site ou l'e-mail officiel de l'organisation ; en cas de doute, appelle l'organisation au numéro de son site officiel.";
      await send(chatId, out, [[{ text: "🏠 Menu", callback_data: "menu" }]]); return;
    }
    // Commandes et intentions
    const lt = normText(text);
    if (text.startsWith("/start") || text.startsWith("/menu") || lt === "menu") {
      u.cvFlow = null; u.scamFlow = false; await store.upsertUser(u);
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
    return { alerts, offers: offers.length, users: users.length };
  }

  return { handleUpdate, ingestOpps, housekeeping };
}
module.exports = { createBot, analyzeOffer };
