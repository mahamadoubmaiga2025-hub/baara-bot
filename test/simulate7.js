// Simulation production RealFreeCV — le Pack d'un compte lié est produit par l'API du site (analyse IA, CV adapté officiel, lettre du site), avec repli local si le quota IA est atteint.
const assert = require("assert");

let quotaMode = false;
const apiCalls = [];
const RFC_LETTER = "Bamako, le 10 novembre 2026\n\nObjet : Candidature au poste visé\n\nMadame, Monsieur,\n\nCette lettre a été produite par RealFreeCV via son API, à partir de mon CV et de l'offre. Elle est sauvegardée dans mon compte du site.\n\nVeuillez agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\nMoussa Traoré";
global.fetch = async (url, opts) => {
  const u = String(url);
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  apiCalls.push({ url: u, method: (opts && opts.method) || "GET", body });
  const reply = (status, obj) => ({ ok: status < 400, status, json: async () => obj });
  if (u.includes("/link/exchange")) {
    if (body && body.code === "ABCD2345") return reply(200, { userToken: "rfcu_jeton_test", user: { email: "moussa@exemple.ml" } });
    return reply(400, { error: { code: "invalid_code", message: "Code invalide." } });
  }
  if (u.includes("/ats/analyze")) {
    if (quotaMode) return reply(403, { error: { code: "quota_exceeded", message: "Quota mensuel d'appels IA dépassé pour cette clé API (30 requêtes IA/mois)." } });
    return reply(200, { score: 91, optimizedSummary: "Résumé optimisé par RealFreeCV pour ce poste précis.", matchedKeywords: ["comptabilité", "sage"], missingKeywords: ["reporting"] });
  }
  if (u.includes("/cv/tailor")) {
    const r = JSON.parse(JSON.stringify(body.resume));
    if (body.analysis && body.analysis.optimizedSummary) r.personal.summary = body.analysis.optimizedSummary;
    if (body.targetRole) r.personal.title = body.targetRole;
    return reply(200, r);
  }
  if (u.includes("/me/letters")) return reply(200, { letterId: "lettre-site-1", body: RFC_LETTER });
  if (u.includes("/me/resumes") && opts && opts.method === "POST") return reply(200, { appId: body.resume.id });
  if (u.includes("/me/resumes")) return reply(200, []);
  return reply(404, { error: { code: "not_found", message: "?" } });
};

const { createBot } = require("../lib/bot");
const { MemoryStore } = require("../lib/store");
const sent = [], docs = [];
const tg = {
  sendMessage: async (c, t, e) => { sent.push({ chat_id: c, text: t, extra: e }); return { ok: true }; },
  answerCallbackQuery: async () => ({ ok: true }),
  sendDocument: async (c, b, f, cap) => { docs.push({ chat_id: c, filename: f, size: b.length, caption: cap || "" }); return { ok: true }; },
  forwardMessage: async () => ({ ok: true }),
};
const store = new MemoryStore();
const bot = createBot({ tg, store, config: { adminId: 42, botUsername: "Baaramlbot", omNumber: "+223 72 07 20 72", waveNumber: "+223 72 07 20 72", rfcApiKey: "rfcv_cle_test" } });
const U = { id: 300, first_name: "Moussa" };
const A = { id: 42, first_name: "Admin" };
const msg = (t, from, chat) => ({ message: { chat: { id: chat || (from || U).id }, from: from || U, text: t } });
const cb = (d, from) => ({ callback_query: { id: "c" + Math.random(), from: from || U, message: { chat: { id: (from || U).id } }, data: d } });
const adminButtons = () => sent.filter(x => x.chat_id === 42 && x.extra && x.extra.reply_markup).flatMap(x => x.extra.reply_markup.inline_keyboard.flat());
const userButtons = () => sent.filter(x => x.chat_id === 300 && x.extra && x.extra.reply_markup).flatMap(x => x.extra.reply_markup.inline_keyboard.flat());
const { OPPORTUNITIES } = require("../lib/data");

async function buyPackAndValidate() {
  await bot.handleUpdate(cb("svc_pack"));
  await bot.handleUpdate(cb("buypick_" + OPPORTUNITIES[0].id));
  await bot.handleUpdate(cb("buy_confirm"));
  const paidBtn = userButtons().filter(b => b.callback_data.startsWith("buy_paid_")).pop();
  assert.ok(paidBtn, "bouton « J'ai payé » présent");
  const cmdId = paidBtn.callback_data.slice("buy_paid_".length);
  await bot.handleUpdate(cb(paidBtn.callback_data));
  const docsBefore = docs.length;
  await bot.handleUpdate(msg("OM-CODE-1"));
  await bot.handleUpdate(cb("admv_ok_" + cmdId, A));
  return docs.slice(docsBefore);
}

(async () => {
  await bot.handleUpdate(msg("/start"));
  await bot.handleUpdate(cb("prof_emploi"));
  for (const a of ["Bamako", "Licence", "2 ans", "finance"]) await bot.handleUpdate(msg(a));
  await bot.handleUpdate(cb("cv_start"));
  for (const a of ["Moussa Traoré", "Comptable", "moussa@exemple.ml · 70 00 00 00", "Bamako", "Comptable — Cabinet XYZ (2023 - Présent) : saisie et rapprochements", "Licence finance — FSEG Bamako, 2023", "Excel, Sage, rigueur", "Français (courant)"]) await bot.handleUpdate(msg(a));
  // Liaison du compte
  await bot.handleUpdate(cb("rfc_link"));
  await bot.handleUpdate(msg("ABCD2345"));
  assert.ok((await store.getUser(300)).rfc, "compte lié avant achat");
  apiCalls.length = 0;

  // --- Pack n°1 : production RealFreeCV ---
  const docs1 = await buyPackAndValidate();
  assert.strictEqual(docs1.length, 2, "pack livré : 2 documents");
  const urls = apiCalls.map(c => c.url);
  assert.ok(urls.some(x => x.includes("/ats/analyze")), "analyse IA RealFreeCV appelée");
  assert.ok(urls.some(x => x.includes("/cv/tailor")), "adaptation officielle RealFreeCV appelée");
  assert.ok(urls.some(x => x.includes("/me/letters")), "lettre produite par RealFreeCV");
  const adaptedPush = apiCalls.find(c => c.url.includes("/me/resumes") && c.method === "POST" && String(c.body.resume.title || "").startsWith("CV adapté"));
  assert.ok(adaptedPush, "CV adapté officiel déposé dans le compte du site");
  assert.strictEqual(adaptedPush.body.resume.personal.summary, "Résumé optimisé par RealFreeCV pour ce poste précis.", "le résumé vient bien de l'analyse du site");
  assert.ok(docs1[0].caption.includes("produit par RealFreeCV"), "le client est informé de la production RealFreeCV");
  assert.ok(docs1[1].caption.includes("RealFreeCV"), "lettre annoncée comme produite par RealFreeCV");

  // --- Pack n°2 : quota IA atteint -> repli local, livraison quand même ---
  quotaMode = true;
  apiCalls.length = 0;
  const docs2 = await buyPackAndValidate();
  assert.strictEqual(docs2.length, 2, "quota atteint : le pack est quand même livré (production locale)");
  assert.ok(!apiCalls.some(c => c.url.includes("/me/letters")), "quota atteint : pas d'appel lettre au site");
  assert.ok(!docs2[0].caption.includes("produit par RealFreeCV"), "repli local annoncé honnêtement, sans mention RealFreeCV");
  const u = await store.getUser(300);
  assert.ok(u.rfc.lastError && u.rfc.lastError.includes("quota"), "l'erreur de quota est tracée dans le dossier");

  console.log("✅ TESTS PRODUCTION REALFREECV PASSENT : analyse IA + adaptation officielle + lettre du site pour les comptes liés (CV adapté déposé au compte, résumé issu de l'analyse), repli local automatique et honnête quand le quota IA est atteint.");
})().catch((e) => { console.error("❌ ÉCHEC PRODUCTION RFC :", e.message); process.exit(1); });
