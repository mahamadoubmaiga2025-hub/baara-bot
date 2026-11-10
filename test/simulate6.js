// Simulation Baara × RealFreeCV — liaison de compte, synchro sortante, récupération entrante.
const assert = require("assert");

// --- Faux serveur RealFreeCV (API v1) ---
const apiCalls = [];
const SITE_RESUME = {
  id: "rfcv-site-1", title: "CV Site — Développeuse", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", locale: "fr",
  personal: { firstName: "Awa", lastName: "Diallo", title: "Développeuse web", email: "awa@exemple.ml", phone: "+223 76 11 22 33", city: "Bamako", country: "Mali", summary: "Développeuse web avec 3 ans d'expérience." },
  experiences: [{ id: "e1", jobTitle: "Développeuse", company: "Studio ML", location: "Bamako", startDate: "2023", endDate: "", current: true, description: "Applications web et mobiles." }],
  educations: [{ id: "ed1", degree: "Licence informatique", school: "FST Bamako", location: "", startDate: "2019", endDate: "2022", description: "" }],
  skills: [{ id: "s1", name: "JavaScript" }, { id: "s2", name: "React" }],
  languages: [{ id: "l1", name: "Français", level: "courant" }],
  certifications: [], projects: [], interests: [],
  design: { templateId: "moderne", primaryColor: "#12283F", fontFamily: "Inter", fontSize: "medium", spacing: "normal" },
};
global.fetch = async (url, opts) => {
  const u = String(url);
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  apiCalls.push({ url: u, method: (opts && opts.method) || "GET", body });
  const reply = (status, obj) => ({ ok: status < 400, status, json: async () => obj });
  if (u.includes("/api/v1/link/exchange")) {
    if (body && body.code === "ABCD2345") return reply(200, { userToken: "rfcu_jeton_test", user: { email: "awa@exemple.ml" } });
    return reply(400, { error: { code: "invalid_code", message: "Code de liaison absent, expiré ou déjà utilisé." } });
  }
  if (u.includes("/api/v1/me/resumes/one")) return reply(200, SITE_RESUME);
  if (u.includes("/api/v1/me/resumes") && (!opts || !opts.method || opts.method === "GET")) return reply(200, [{ appId: "rfcv-site-1", title: "CV Site — Développeuse", updatedAt: "2026-11-01T00:00:00.000Z" }]);
  if (u.includes("/api/v1/me/resumes") && opts.method === "POST") {
    if (String(body.resume.id).endsWith("-plein")) return reply(400, { error: { code: "cv_limit", message: "Plafond atteint." } });
    return reply(200, { appId: body.resume.id });
  }
  return reply(404, { error: { code: "not_found", message: "?" } });
};

const { createBot } = require("../lib/bot");
const { MemoryStore } = require("../lib/store");
const { cvToResume, resumeToCv } = require("../lib/rfc");
const sent = [], docs = [];
const tg = {
  sendMessage: async (c, t, e) => { sent.push({ chat_id: c, text: t, extra: e }); return { ok: true }; },
  answerCallbackQuery: async () => ({ ok: true }),
  sendDocument: async (c, b, f, cap) => { docs.push({ chat_id: c, filename: f, size: b.length }); return { ok: true }; },
  forwardMessage: async () => ({ ok: true }),
};
const store = new MemoryStore();
const bot = createBot({ tg, store, config: { adminId: 42, botUsername: "Baaramlbot", rfcApiKey: "rfcv_cle_test" } });
const U = { id: 200, first_name: "Moussa" };
const msg = (t) => ({ message: { chat: { id: 200 }, from: U, text: t } });
const cb = (d) => ({ callback_query: { id: "c" + Math.random(), from: U, message: { chat: { id: 200 } }, data: d } });
const lastText = () => sent[sent.length - 1].text;
const kbOf = () => ((sent[sent.length - 1].extra.reply_markup.inline_keyboard) || []).flat();

(async () => {
  // Conversions (unités)
  const mapped = cvToResume({ name: "Mahamadou Boubacar Maïga", title: "Chef de projet", contact: "contact@exemple.ml · +223 72 07 20 72", city: "Bamako", summary: "Résumé.", expRaw: "Fondateur — FasoCompta (Janvier 2022 - Présent) : plateforme SaaS\nComptable — Cabinet XYZ, 2020-2022", eduRaw: "Licence Économie — FSEG Bamako, 2018", skills: ["Gestion de projet", "Excel"], skillsRaw: "Gestion de projet, Excel", langRaw: "Français (courant), Bambara (natif)" }, 883782997);
  assert.strictEqual(mapped.id, "baara-883782997", "id stable par utilisateur");
  assert.strictEqual(mapped.personal.firstName, "Mahamadou Boubacar", "prénom découpé");
  assert.strictEqual(mapped.personal.lastName, "Maïga", "nom découpé");
  assert.strictEqual(mapped.personal.email, "contact@exemple.ml", "e-mail extrait");
  assert.ok(mapped.personal.phone.includes("72 07 20 72"), "téléphone extrait");
  assert.strictEqual(mapped.experiences[0].company, "FasoCompta", "entreprise parsée");
  assert.strictEqual(mapped.experiences[0].current, true, "poste actuel détecté");
  assert.strictEqual(mapped.skills.length, 2, "compétences converties");
  const back = resumeToCv(SITE_RESUME);
  assert.strictEqual(back.name, "Awa Diallo", "retour : nom recomposé");
  assert.ok(back.expRaw.includes("Studio ML"), "retour : expérience recomposée");

  // Parcours utilisateur
  await bot.handleUpdate(msg("/start"));
  await bot.handleUpdate(cb("prof_emploi"));
  for (const a of ["Bamako", "Licence", "2 ans", "finance"]) await bot.handleUpdate(msg(a));
  await bot.handleUpdate(cb("cv_start"));
  for (const a of ["Moussa Traoré", "Comptable", "moussa@exemple.ml · 70 00 00 00", "Bamako", "Comptable — Cabinet XYZ (2023 - Présent) : saisie et rapprochements", "Licence finance — FSEG Bamako, 2023", "Excel, Sage, rigueur", "Français (courant)"]) await bot.handleUpdate(msg(a));
  // Écran liaison (non lié)
  await bot.handleUpdate(cb("rfc"));
  assert.ok(lastText().includes("Lier ton compte RealFreeCV"), "écran de liaison affiché");
  // Mauvais format de code
  await bot.handleUpdate(cb("rfc_link"));
  await bot.handleUpdate(msg("123"));
  assert.ok(lastText().includes("ne ressemble pas"), "format de code refusé poliment");
  // Code expiré/inconnu
  await bot.handleUpdate(cb("rfc_link"));
  await bot.handleUpdate(msg("ZZZZ9999"));
  assert.ok(lastText().includes("Liaison impossible"), "code refusé par l'API -> message clair");
  // Bon code (minuscules acceptées)
  await bot.handleUpdate(cb("rfc_link"));
  await bot.handleUpdate(msg("abcd2345"));
  assert.ok(sent.some(x => x.text.includes("Compte RealFreeCV lié : awa@exemple.ml")), "liaison établie avec le bon compte");
  const u = await store.getUser(200);
  assert.ok(u.rfc && u.rfc.token === "rfcu_jeton_test", "jeton stocké dans le dossier utilisateur");
  const push = apiCalls.find(c => c.url.includes("/me/resumes") && c.method === "POST");
  assert.ok(push && push.body.resume.id === "baara-200", "CV poussé dès la liaison");
  assert.strictEqual(push.body.resume.personal.firstName, "Moussa", "contenu du CV poussé correct");
  // Synchro manuelle
  apiCalls.length = 0;
  await bot.handleUpdate(cb("rfc_sync"));
  assert.ok(lastText().includes("CV synchronisé sur RealFreeCV"), "synchro manuelle confirmée");
  assert.ok(apiCalls.some(c => c.method === "POST"), "appel API de synchro émis");
  // Récupération d'un CV du site
  await bot.handleUpdate(cb("rfc_pull"));
  assert.ok(kbOf().some(b => b.callback_data === "rfc_get_rfcv-site-1"), "liste des CV du site proposée");
  const docsBefore = docs.length;
  await bot.handleUpdate(cb("rfc_get_rfcv-site-1"));
  const u2 = await store.getUser(200);
  assert.strictEqual(u2.cvData.name, "Awa Diallo", "CV du site devenu le CV Baara");
  assert.ok(docs.length > docsBefore, "PDF régénéré après récupération");
  // Délier
  await bot.handleUpdate(cb("rfc_unlink"));
  assert.strictEqual((await store.getUser(200)).rfc, null, "déliaison effective");
  console.log("✅ TESTS REALFREECV PASSENT : conversions aller-retour, liaison par code (formats et refus gérés), synchro sortante dès la liaison + manuelle, récupération entrante avec PDF, déliaison.");
})().catch((e) => { console.error("❌ ÉCHEC RFC :", e.message); process.exit(1); });
