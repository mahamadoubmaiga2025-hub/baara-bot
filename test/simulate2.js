// Simulation Baara V2 — onboarding détaillé, match, quiz, candidatures, lettre, entretien, signalements.
const assert = require("assert");
const { createBot } = require("../lib/bot");
const { MemoryStore } = require("../lib/store");

const sent = [], docs = [];
const tg = {
  sendMessage: async (chat_id, text, extra) => { sent.push({ chat_id, text, extra }); return { ok: true }; },
  answerCallbackQuery: async () => ({ ok: true }),
  sendDocument: async (chat_id, buffer, filename, caption) => { docs.push({ chat_id, size: buffer.length, filename, caption }); return { ok: true }; },
  // pas de downloadFile : les médias doivent dégrader proprement sans IA
};
const store = new MemoryStore();
const bot = createBot({ tg, store, config: { adminId: 42, botUsername: "Baaramlbot" } });
const U = { id: 200, first_name: "Moussa" };
const msg = (text) => ({ message: { chat: { id: 200 }, from: U, text } });
const cb = (data) => ({ callback_query: { id: "c" + Math.random(), from: U, message: { chat: { id: 200 } }, data } });
const lastText = () => sent[sent.length - 1].text;
const lastKb = () => (sent[sent.length - 1].extra.reply_markup.inline_keyboard || []).flat();

(async () => {
  await bot.handleUpdate(msg("/start"));
  await bot.handleUpdate(cb("prof_concours"));
  assert.ok(lastText().includes("1/4"), "onboarding détaillé démarré");
  await bot.handleUpdate(msg("Bamako"));
  await bot.handleUpdate(msg("Licence"));
  await bot.handleUpdate(msg("2 ans"));
  await bot.handleUpdate(msg("éducation, administration"));
  assert.ok(sent.some(x => x.text.includes("profil est complet")), "onboarding terminé");
  const u = await store.getUser(200);
  assert.ok(u.details && u.details.city === "Bamako", "détails enregistrés");
  // Radar avec match
  await bot.handleUpdate(cb("radar_all"));
  assert.ok(/Match \d+%/.test(lastText()), "score de match affiché");
  // Fiche offre enrichie
  await bot.handleUpdate(cb("off_fp-2026"));
  const labels = lastKb().map(b => b.text).join(" | ");
  assert.ok(labels.includes("Lettre de motivation") && labels.includes("Checklist") && labels.includes("J'ai postulé") && labels.includes("WhatsApp"), "fiche enrichie complète");
  // Checklist
  await bot.handleUpdate(cb("check_fp-2026"));
  assert.ok(lastText().includes("Checklist du dossier") && lastText().includes("NINA"), "checklist concours OK");
  // Candidature suivie
  await bot.handleUpdate(cb("postule_fp-2026"));
  assert.ok(lastText().includes("Candidature enregistrée"), "postulé OK");
  await bot.handleUpdate(cb("myapps"));
  assert.ok(lastText().includes("1 122 postes"), "mes candidatures liste l'offre");
  // Lettre (mode sans IA -> gabarit)
  await bot.handleUpdate(cb("cv_start"));
  const answers = ["Moussa Traoré", "Enseignant", "moussa@example.com", "Bamako", "Enseignant — École privée, 2023-2025", "Licence en éducation, 2023", "Pédagogie, patience, organisation", "Français (courant)"];
  for (const a of answers) await bot.handleUpdate(msg(a));
  const docsBefore = docs.length;
  await bot.handleUpdate(cb("lettre_fp-2026"));
  assert.ok(docs.length > docsBefore && docs[docs.length - 1].filename.startsWith("Lettre_"), "lettre PDF générée (gabarit)");
  // Entretien (questions de repli)
  await bot.handleUpdate(cb("prep_fp-2026"));
  assert.ok(lastText().includes("Question 1/"), "simulation démarrée");
  await bot.handleUpdate(msg("Je suis enseignant depuis 2 ans, j'ai formé 3 classes avec d'excellents résultats au DEF."));
  assert.ok(lastText().includes("Question 2/"), "question suivante après réponse");
  await bot.handleUpdate(msg("stop"));
  assert.ok(lastText().includes("Simulation arrêtée"), "stop propre");
  // Quiz du jour
  await bot.handleUpdate(cb("quiz_start"));
  const qkb = lastKb();
  assert.ok(qkb.length === 4 && qkb[0].callback_data.startsWith("qans_"), "question du jour posée");
  const dayIdx = Math.floor(Date.now() / 86400000) % 10;
  const { QUIZ } = require("../lib/data");
  await bot.handleUpdate(cb("qans_" + dayIdx + "_" + QUIZ[dayIdx].answer));
  assert.ok(lastText().includes("Bonne réponse"), "bonne réponse quiz");
  assert.ok(lastText().includes("Série : 1"), "série démarrée");
  await bot.handleUpdate(cb("quiz_start"));
  assert.ok(lastText().includes("déjà répondu"), "une seule question par jour");
  // Signalement communautaire
  const fraud = "URGENT recrutement : envoie des frais de dossier de 25 000 F au +223 70 11 22 33 et ton code PIN, places limitées !";
  await bot.handleUpdate(cb("scam_start"));
  await bot.handleUpdate(msg(fraud));
  assert.ok(lastText().includes("RISQUE ÉLEVÉ"), "fraude détectée");
  await bot.handleUpdate(cb("report_x"));
  assert.ok(lastText().includes("signalés"), "signalement enregistré");
  await bot.handleUpdate(cb("scam_start"));
  await bot.handleUpdate(msg(fraud + " (deuxième envoi)"));
  assert.ok(lastText().includes("Communauté Baara") && lastText().includes("signalé 1 fois"), "alerte communautaire au 2e passage");
  // Média sans IA : dégradation propre
  await bot.handleUpdate({ message: { chat: { id: 200 }, from: U, document: { file_id: "x", mime_type: "application/pdf" } } });
  assert.ok(lastText().includes("pas encore lire les fichiers"), "dégradation média propre");
  console.log("✅ TESTS V2 PASSENT : onboarding détaillé, match, fiche enrichie, checklist, candidatures, lettre, entretien, quiz+série, signalements communautaires, dégradation média.");
})().catch((e) => { console.error("❌ ÉCHEC V2 :", e.message); process.exit(1); });

// (voir simulate3.js pour la régression interruption de flux)
