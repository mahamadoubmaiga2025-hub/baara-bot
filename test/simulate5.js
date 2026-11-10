// Fumée : Document sur mesure + CV pro adapté (branches de production restantes)
const assert = require("assert");
const { createBot } = require("../lib/bot");
const { MemoryStore } = require("../lib/store");
const sent = [], docs = [];
const tg = { sendMessage: async (c, t, e) => { sent.push({ chat_id: c, text: t, extra: e }); return { ok: true }; }, answerCallbackQuery: async () => ({}), sendDocument: async (c, b, f, cap) => { docs.push({ chat_id: c, filename: f, size: b.length }); return { ok: true }; }, forwardMessage: async () => ({ ok: true }) };
const store = new MemoryStore();
const bot = createBot({ tg, store, config: { adminId: 42, botUsername: "Baaramlbot", omNumber: "111", waveNumber: "222" } });
const A = { id: 42, first_name: "Admin" }, U = { id: 500, first_name: "Fatou" };
const msg = (f, t) => ({ message: { chat: { id: f.id }, from: f, text: t } });
const cb = (f, d) => ({ callback_query: { id: "x" + Math.random(), from: f, message: { chat: { id: f.id } }, data: d } });
const lastTo = (id) => sent.filter(x => x.chat_id === id).pop();
const cmdOf = (s) => (s.text.match(/CMD-\d+/) || [])[0];
(async () => {
  await bot.handleUpdate(msg(U, "/start"));
  await bot.handleUpdate(cb(U, "prof_emploi"));
  for (const a of ["Bamako", "Licence", "3 ans", "santé"]) await bot.handleUpdate(msg(U, a));
  await bot.handleUpdate(cb(U, "cv_start"));
  for (const a of ["Fatou Diarra", "Infirmière", "fatou@example.com", "Bamako", "Infirmière — CSRef, 2022-2025", "Diplôme d'État infirmier, 2022", "Soins, vaccination, urgence", "Français"]) await bot.handleUpdate(msg(U, a));
  // CV pro
  await bot.handleUpdate(cb(U, "svc_cvpro"));
  assert.ok(lastTo(500).text.includes("Quel poste"), "question poste visé");
  await bot.handleUpdate(msg(U, "Sage-femme en ONG humanitaire"));
  assert.ok(lastTo(500).text.includes("Récapitulatif") && lastTo(500).text.includes("3 500"), "récap CV pro 3 500");
  await bot.handleUpdate(cb(U, "buy_confirm"));
  const c1 = cmdOf(lastTo(500));
  await bot.handleUpdate(cb(U, "buy_paid_" + c1));
  await bot.handleUpdate(msg(U, "WAVE-12345"));
  await bot.handleUpdate(cb(A, "admv_ok_" + c1));
  assert.ok(docs.some(d => d.filename === "CV_pro.pdf"), "CV pro livré");
  // Document sur mesure
  await bot.handleUpdate(cb(U, "svc_doc"));
  await bot.handleUpdate(cb(U, "buydoc_rapport"));
  assert.ok(lastTo(500).text.includes("Objet du document"), "question objet");
  await bot.handleUpdate(msg(U, "Rapport d'activité du mois d'octobre"));
  await bot.handleUpdate(msg(U, "La Direction de l'ONG Espoir Sahel"));
  await bot.handleUpdate(msg(U, "120 consultations réalisées, campagne de vaccination dans 3 villages, 2 formations du personnel."));
  assert.ok(lastTo(500).text.includes("Récapitulatif") && lastTo(500).text.includes("1 500"), "récap doc 1 500");
  await bot.handleUpdate(cb(U, "buy_confirm"));
  const c2 = cmdOf(lastTo(500));
  await bot.handleUpdate(cb(U, "buy_paid_" + c2));
  await bot.handleUpdate(msg(U, "OM-67890"));
  await bot.handleUpdate(cb(A, "admv_ok_" + c2));
  assert.ok(docs.some(d => d.filename === "Document_sur_mesure.pdf"), "document sur mesure livré");
  console.log("✅ FUMÉE OK : CV pro adapté livré, Document sur mesure livré (questionnaire guidé complet).");
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
