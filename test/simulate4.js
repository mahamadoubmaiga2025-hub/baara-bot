// Simulation Baara COMMERCE — parcours d'achat complet du Pack (paiement simulé),
// parrainage, crédits, rejet motivé, relances, entretien premium, limites gratuites.
const assert = require("assert");
const { createBot } = require("../lib/bot");
const { MemoryStore } = require("../lib/store");
const { transcriptionPrice } = require("../lib/catalog");

const sent = [], docs = [], forwards = [];
const tg = {
  sendMessage: async (chat_id, text, extra) => { sent.push({ chat_id, text, extra }); return { ok: true }; },
  answerCallbackQuery: async () => ({ ok: true }),
  sendDocument: async (chat_id, buffer, filename, caption) => { docs.push({ chat_id, size: buffer.length, filename, caption }); return { ok: true }; },
  forwardMessage: async (chat_id, from_chat_id, message_id) => { forwards.push({ chat_id, from_chat_id, message_id }); return { ok: true }; },
};
const store = new MemoryStore();
const bot = createBot({ tg, store, config: { adminId: 42, botUsername: "Baaramlbot", omNumber: "+223 72 07 20 72", waveNumber: "+223 72 07 20 72" } });
const ADMIN = { id: 42, first_name: "Admin" };
const PARRAIN = { id: 300, first_name: "Parrain" };
const CLIENT = { id: 200, first_name: "Moussa" };
const msg = (from, text) => ({ message: { chat: { id: from.id }, from, text } });
const cb = (from, data) => ({ callback_query: { id: "c" + Math.random(), from, message: { chat: { id: from.id } }, data } });
const lastTo = (id) => { const s = sent.filter(x => x.chat_id === id); return s[s.length - 1]; };
const kbOf = (s) => ((s.extra && s.extra.reply_markup && s.extra.reply_markup.inline_keyboard) || []).flat();
const getConfig = async () => store.getUser(0);
const orderIdFrom = (s) => (s.text.match(/CMD-\d+/) || [])[0];

async function completeProfile(from, answers) {
  await bot.handleUpdate(msg(from, "/start"));
  await bot.handleUpdate(cb(from, "prof_emploi"));
  for (const a of answers) await bot.handleUpdate(msg(from, a));
}
async function makeCv(from, answers) {
  await bot.handleUpdate(cb(from, "cv_start"));
  for (const a of answers) await bot.handleUpdate(msg(from, a));
}

(async () => {
  // Prix transcription (unité)
  assert.strictEqual(transcriptionPrice(300), 500, "transcription 5 min = 500");
  assert.strictEqual(transcriptionPrice(600), 500, "transcription 10 min = 500");
  assert.strictEqual(transcriptionPrice(660), 550, "transcription 11 min = 550");
  assert.strictEqual(transcriptionPrice(1500), 1250, "transcription 25 min = 1250");

  // Parrain inscrit normalement
  await completeProfile(PARRAIN, ["Bamako", "Master", "5 ans", "finance"]);
  // Client arrive via le lien du parrain
  await bot.handleUpdate(msg(CLIENT, "/start ref_300"));
  const client0 = await store.getUser(200);
  assert.strictEqual(client0.referredBy, 300, "filleul rattaché au parrain");
  assert.ok(sent.some(x => x.chat_id === 300 && x.text.includes("parrainage")), "parrain notifié de l'inscription");
  await bot.handleUpdate(cb(CLIENT, "prof_emploi"));
  for (const a of ["Bamako", "Licence", "2 ans", "finance"]) await bot.handleUpdate(msg(CLIENT, a));
  await makeCv(CLIENT, ["Moussa Traoré", "Comptable", "moussa@example.com · 70 00 00 00", "Bamako", "Comptable — Cabinet XYZ, 2023-2025 : saisie, rapprochements bancaires", "Licence en finance-comptabilité, FSEG Bamako, 2023", "Excel, Sage Comptabilité, rigueur", "Français (courant), Bambara (natif)"]);
  assert.strictEqual(docs.length, 1, "CV de base livré");
  const offersKb = kbOf(lastTo(200)); // dernier message = menu ou récap ; on passe par le radar pour une offre
  await bot.handleUpdate(cb(CLIENT, "radar_all"));
  const tailorBtn = kbOf(lastTo(200)).find(b => b.callback_data && b.callback_data.startsWith("tailor_"));
  const offerId = tailorBtn.callback_data.slice(7);

  // Aperçu gratuit : score, aucun PDF adapté
  await bot.handleUpdate(cb(CLIENT, "tailor_" + offerId));
  assert.ok(lastTo(200).text.includes("Score d'adéquation"), "score gratuit affiché");
  assert.strictEqual(docs.length, 1, "aucun PDF adapté en gratuit");

  // Achat du Pack via l'upsell (offre présélectionnée) : remise parrainage -10 %
  await bot.handleUpdate(cb(CLIENT, "svco_pack_" + offerId));
  assert.ok(lastTo(200).text.includes("Récapitulatif"), "récap affiché directement (offre connue)");
  assert.ok(lastTo(200).text.includes("4 500") && lastTo(200).text.includes("Remise parrainage") && lastTo(200).text.includes("4 050"), "prix 4 500 − 10 % = 4 050");
  await bot.handleUpdate(cb(CLIENT, "buy_confirm"));
  const payScreen = lastTo(200);
  assert.ok(payScreen.text.includes("+223 72 07 20 72"), "numéros marchand affichés");
  const cmd1 = orderIdFrom(payScreen);
  let cfg = await getConfig();
  let order = cfg.orders.find(o => o.id === cmd1);
  assert.ok(order && order.status === "attente_paiement" && order.total === 4050, "commande créée en attente (4 050)");
  // Preuve par capture photo
  await bot.handleUpdate(cb(CLIENT, "buy_paid_" + cmd1));
  await bot.handleUpdate({ message: { chat: { id: 200 }, from: CLIENT, message_id: 777, photo: [{ file_id: "capture1" }] } });
  assert.ok(forwards.some(f => f.chat_id === 42 && f.message_id === 777), "capture transmise à l'admin");
  cfg = await getConfig(); order = cfg.orders.find(o => o.id === cmd1);
  assert.strictEqual(order.status, "a_valider", "commande à valider après capture");
  assert.ok(kbOf(sent.filter(x => x.chat_id === 42).pop()).some(b => b.callback_data === "admv_ok_" + cmd1), "admin a les boutons de validation");
  // Validation admin -> production -> 2 PDF
  const docsBefore = docs.length;
  await bot.handleUpdate(cb(ADMIN, "admv_ok_" + cmd1));
  const newDocs = docs.slice(docsBefore).filter(d => d.chat_id === 200);
  assert.ok(newDocs.some(d => d.filename.startsWith("CV_adapte")) && newDocs.some(d => d.filename.startsWith("Lettre_")), "Pack livré : CV adapté + lettre");
  cfg = await getConfig(); order = cfg.orders.find(o => o.id === cmd1);
  assert.strictEqual(order.status, "livre", "commande livrée");
  const parrain = await store.getUser(300);
  assert.strictEqual(parrain.credit, 500, "parrain crédité de 500 F");

  // Entretien premium : session complète après validation
  await bot.handleUpdate(cb(CLIENT, "svco_entretien_" + offerId));
  assert.ok(lastTo(200).text.includes("2 000") && !lastTo(200).text.includes("Remise"), "2e commande sans remise parrainage");
  await bot.handleUpdate(cb(CLIENT, "buy_confirm"));
  const cmd2 = orderIdFrom(lastTo(200));
  await bot.handleUpdate(cb(CLIENT, "buy_paid_" + cmd2));
  await bot.handleUpdate(msg(CLIENT, "OM-TRANS-998877")); // preuve par code texte
  cfg = await getConfig(); order = cfg.orders.find(o => o.id === cmd2);
  assert.ok(order.status === "a_valider" && order.proof.value === "OM-TRANS-998877", "preuve texte acceptée");
  await bot.handleUpdate(cb(ADMIN, "admv_ok_" + cmd2));
  const client = await store.getUser(200);
  assert.ok(client.prepFlow && client.prepFlow.premium === true, "session premium démarrée à la validation");
  for (let i = 0; i < 5; i++) await bot.handleUpdate(msg(CLIENT, "Réponse travaillée n°" + (i + 1) + " avec un exemple concret et chiffré."));
  assert.ok(lastTo(200).text.includes("PREMIUM terminée"), "session premium menée au bout");

  // Crédits admin + achat partiellement payé en crédits + rejet motivé avec remboursement des crédits
  await bot.handleUpdate(cb(ADMIN, "adm_credit"));
  await bot.handleUpdate(msg(ADMIN, "200 1000"));
  assert.strictEqual((await store.getUser(200)).credit, 1000, "crédit admin appliqué");
  await bot.handleUpdate(cb(CLIENT, "svc_cvopt"));
  assert.ok(lastTo(200).text.includes("Crédits utilisés") || lastTo(200).text.includes("crédits"), "récap mentionne les crédits");
  assert.ok(lastTo(200).text.includes("1 000"), "total après crédits = 1 000");
  await bot.handleUpdate(cb(CLIENT, "buy_confirm"));
  const cmd3 = orderIdFrom(lastTo(200));
  assert.strictEqual((await store.getUser(200)).credit, 0, "crédits débités à la commande");
  await bot.handleUpdate(cb(CLIENT, "buy_paid_" + cmd3));
  await bot.handleUpdate(msg(CLIENT, "CODE-FLOU-123"));
  await bot.handleUpdate(cb(ADMIN, "admv_no_" + cmd3));
  await bot.handleUpdate(msg(ADMIN, "Capture illisible, montant non visible."));
  cfg = await getConfig(); order = cfg.orders.find(o => o.id === cmd3);
  assert.strictEqual(order.status, "rejete", "commande rejetée");
  assert.ok(sent.some(x => x.chat_id === 200 && x.text.includes("Capture illisible")), "motif transmis au client");
  assert.strictEqual((await store.getUser(200)).credit, 1000, "crédits rendus après rejet");

  // Relances automatiques : 2 h (une fois), puis dernier rappel à 24 h
  cfg = await getConfig();
  cfg.orders.push({ id: "CMD-9001", userId: 200, service: "cvopt", label: "CV optimisé ATS", base: 2000, discount: 0, creditUsed: 0, total: 2000, payload: {}, status: "attente_paiement", createdAt: new Date(Date.now() - 3 * 3600000).toISOString(), r2: false, r24: false });
  await store.upsertUser(cfg);
  const beforeMsgs = sent.filter(x => x.chat_id === 200 && x.text.includes("CMD-9001")).length;
  await bot.housekeeping();
  await bot.housekeeping();
  const afterMsgs = sent.filter(x => x.chat_id === 200 && x.text.includes("CMD-9001")).length;
  assert.strictEqual(afterMsgs - beforeMsgs, 1, "un seul rappel à 2 h malgré deux passages");
  cfg = await getConfig();
  const stale = cfg.orders.find(o => o.id === "CMD-9001");
  stale.createdAt = new Date(Date.now() - 30 * 3600000).toISOString();
  await store.upsertUser(cfg);
  await bot.housekeeping();
  assert.ok(sent.some(x => x.chat_id === 200 && x.text.includes("Dernier rappel") && x.text.includes("CMD-9001")), "dernier rappel à 24 h envoyé");

  // Stats + rapport
  const stats = await bot._commerce.statsText();
  assert.ok(stats.includes("CA encaissé") && stats.includes("5 850"), "stats avec objectif");
  const report = await bot._commerce.buildAdminReport();
  assert.ok(report.includes("Rapport Baara Business"), "rapport du matin généré");

  // Entretien gratuit plafonné à 3 questions + upsell
  await bot.handleUpdate(cb(CLIENT, "prep_" + offerId));
  assert.ok(lastTo(200).text.includes("Question 1/3"), "gratuit = 3 questions");
  for (let i = 0; i < 3; i++) await bot.handleUpdate(msg(CLIENT, "Réponse courte " + (i + 1)));
  assert.ok(lastTo(200).text.includes("Simulation gratuite terminée"), "fin du gratuit après 3 réponses");
  assert.ok(kbOf(lastTo(200)).some(b => b.callback_data === "svco_entretien_" + offerId), "upsell premium proposé en fin de gratuit");

  console.log("✅ TESTS COMMERCE PASSENT : prix transcription, parrainage (−10 % + 500 F parrain), Pack complet (capture → validation → 2 PDF), entretien premium livré, crédits admin, rejet motivé + remboursement crédits, relances 2 h/24 h sans doublon, stats + rapport, gratuit plafonné (score seul, entretien 3 questions).");
})().catch((e) => { console.error("❌ ÉCHEC COMMERCE :", e.message); process.exit(1); });
