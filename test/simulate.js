// Simulation Baara — faux client Telegram, parcours complet.
const assert = require("assert");
const { createBot, analyzeOffer } = require("../lib/bot");
const { MemoryStore } = require("../lib/store");

const sent = [];
const docs = [];
const tg = {
  sendMessage: async (chat_id, text, extra) => { sent.push({ chat_id, text, extra }); return { ok: true }; },
  answerCallbackQuery: async () => ({ ok: true }),
  sendDocument: async (chat_id, buffer, filename, caption) => { docs.push({ chat_id, size: buffer.length, filename, caption }); return { ok: true }; },
};
const store = new MemoryStore();
const bot = createBot({ tg, store, config: { adminId: 42, botUsername: "Baaramlbot" } });
const U = { id: 100, first_name: "Awa" };
const msg = (text) => ({ message: { chat: { id: 100 }, from: U, text } });
const cb = (data) => ({ callback_query: { id: "c" + Math.random(), from: U, message: { chat: { id: 100 } }, data } });
const lastText = () => sent[sent.length - 1].text;

(async () => {
  await bot.handleUpdate(msg("/start"));
  assert.ok(lastText().includes("Bienvenue sur Baara"), "accueil nouveau");
  await bot.handleUpdate(cb("prof_emploi"));
  assert.ok(sent.some(s => s.text.includes("Profil enregistré")), "profil enregistré");
  await bot.handleUpdate(cb("radar_mine"));
  assert.ok(lastText().includes("Offres pour ton profil"), "radar filtré");
  assert.ok(lastText().includes("Fonction publique") || lastText().includes("FONGIM") || lastText().includes("NRC"), "offres seed présentes");
  const kbs = sent[sent.length - 1].extra.reply_markup.inline_keyboard.flat();
  const tailorBtn = kbs.find(b => b.callback_data && b.callback_data.startsWith("tailor_"));
  assert.ok(tailorBtn, "bouton CV adapté présent");
  // CV adapté sans CV -> démarre le flux de création
  await bot.handleUpdate(cb(tailorBtn.callback_data));
  assert.ok(lastText().includes("Créons ton CV"), "flux CV démarré");
  const answers = ["Awa Diallo", "Comptable", "awa@example.com · 70 00 00 00", "Bamako", "Comptable junior — Cabinet XYZ, 2023-2025 : saisie, rapprochements", "Licence en finance-comptabilité, FSEG Bamako, 2023", "Excel, Sage Comptabilité, rigueur, organisation", "Français (courant), Bambara (natif)"];
  for (const a of answers) await bot.handleUpdate(msg(a));
  assert.ok(docs.length >= 1, "PDF du CV de base envoyé (docs=" + docs.length + ")");
  assert.ok(!docs.some(d => d.filename.startsWith("CV_adapte")), "CV adapté complet NON livré gratuitement (aperçu payant)");
  assert.ok(docs.every(d => d.size > 500), "PDF non vides");
  assert.ok(sent.some(s => s.text.includes("Score d'adéquation")), "score d'adaptation affiché");
  // Anti-arnaque sur une offre frauduleuse évidente
  const fraud = analyzeOffer("URGENT !!! Recrutement international, gagnez 500 000 FCFA par semaine sans expérience, travail à domicile. Pour t'inscrire envoie des frais de dossier de 25 000 F par Orange Money et ton code PIN au recruteur, contact WhatsApp uniquement. Places limitées, réponds immédiatement !");
  assert.ok(fraud.score >= 40, "score fraude élevé (" + fraud.score + ")");
  assert.ok(fraud.signals.length >= 3, "plusieurs signaux");
  const clean = analyzeOffer("Le Conseil norvégien pour les réfugiés recrute un Finance Manager à Bamako. Candidature en ligne sur notre portail officiel avant le 16 novembre 2026. Le recrutement est entièrement gratuit.");
  assert.ok(clean.score < 40, "offre propre non flaguée rouge (" + clean.score + ")");
  await bot.handleUpdate(cb("scam_start"));
  await bot.handleUpdate(msg("URGENT !!! Recrutement international, gagnez 500 000 FCFA par semaine sans expérience. Envoie des frais de dossier de 25 000 F et ton code PIN. Contact WhatsApp uniquement, places limitées !"));
  assert.ok(lastText().includes("RISQUE ÉLEVÉ"), "verdict rouge dans le flux");
  // Alertes : housekeeping ne doit pas planter
  const hk = await bot.housekeeping();
  assert.ok(typeof hk.alerts === "number" && hk.offers >= 4, "housekeeping OK (" + JSON.stringify(hk) + ")");
  // Ingest d'une nouvelle offre
  const ing = await bot.ingestOpps([{ id: "test-ong-1", profile: "emploi", title: "Chargé de projet — Bamako", org: "ONG Test", deadline: "Dans 30 jours", deadlineISO: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), summary: "Poste test." }]);
  assert.ok(ing.added === 1, "offre du relais ajoutée");
  console.log("✅ TOUS LES TESTS BAARA PASSENT : accueil+profil, radar, CV créé et adapté (PDF), anti-arnaque, alertes, relais.");
})().catch((e) => { console.error("❌ ÉCHEC :", e.message); process.exit(1); });
