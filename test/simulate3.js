// Régression : /start et /menu interrompent un flux en cours.
const assert = require("assert");
const { createBot } = require("../lib/bot");
const { MemoryStore } = require("../lib/store");
const sent = [];
const tg = { sendMessage: async (id, text, extra) => { sent.push({ text, extra }); return { ok: true }; }, answerCallbackQuery: async () => ({ ok: true }), sendDocument: async () => ({ ok: true }) };
const bot = createBot({ tg, store: new MemoryStore(), config: { adminId: 42, botUsername: "Baaramlbot" } });
const U = { id: 300, first_name: "Test" };
const msg = (text) => ({ message: { chat: { id: 300 }, from: U, text } });
const cb = (data) => ({ callback_query: { id: "x" + Math.random(), from: U, message: { chat: { id: 300 } }, data } });
(async () => {
  await bot.handleUpdate(msg("/start"));
  await bot.handleUpdate(cb("prof_emploi"));
  await bot.handleUpdate(msg("Bamako")); await bot.handleUpdate(msg("Licence")); await bot.handleUpdate(msg("1 an")); await bot.handleUpdate(msg("santé"));
  await bot.handleUpdate(cb("cv_start"));
  assert.ok(sent[sent.length - 1].text.includes("1/8"), "flux CV démarré");
  await bot.handleUpdate(msg("/start"));
  const t = sent.map(x => x.text).join("\n");
  assert.ok(!sent[sent.length - 1].text.includes("2/8"), "/start n'est pas consommé comme réponse");
  assert.ok(t.includes("Content de te revoir"), "/start rouvre l'accueil");
  console.log("✅ RÉGRESSION OK : /start et /menu interrompent les flux.");
})().catch(e => { console.error("❌", e.message); process.exit(1); });
