// Baara — handler HTTP (webhook Telegram + points de contrôle), indépendant de l'hébergeur.
// Variables : BOT_TOKEN, ADMIN_ID, BOT_USERNAME, RADAR_PUSH_TOKEN (optionnel).
const { createBot } = require("./lib/bot");
const { createStore } = require("./lib/store");

const store = createStore(process.env);

function tgClient(token) {
  const call = async (method, payload) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return r.json();
  };
  return {
    sendMessage: (chat_id, text, extra) => call("sendMessage", Object.assign({ chat_id, text }, extra || {})),
    answerCallbackQuery: (callback_query_id) => call("answerCallbackQuery", { callback_query_id }),
    sendDocument: async (chat_id, buffer, filename, caption) => {
      const form = new FormData();
      form.append("chat_id", String(chat_id));
      if (caption) form.append("caption", caption);
      form.append("document", new Blob([buffer], { type: "application/pdf" }), filename);
      const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
      return r.json();
    },
  };
}

function makeBot() {
  return createBot({ tg: tgClient(process.env.BOT_TOKEN), store, config: {
    botUsername: process.env.BOT_USERNAME || "BaaraMaliBot",
    adminId: process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : null,
  }});
}

module.exports = async (req, res) => {
  const q = req.query || {};
  if (req.method === "GET" && q.storecheck) {
    try { const ok = store.check ? await store.check() : false; res.status(200).json({ store: store.constructor.name, roundtrip_ok: ok }); }
    catch (e) { res.status(200).json({ store: store.constructor.name, roundtrip_ok: false, error: e.message }); }
    return;
  }
  if (req.method === "GET" && q.housekeeping) {
    try { await store.sync?.().catch(() => {}); const r = await makeBot().housekeeping(); res.status(200).json({ housekeeping: r }); }
    catch (e) { res.status(200).json({ housekeeping: { error: e.message } }); }
    return;
  }
  if (req.method === "GET" && (q.setup || q.info)) {
    const token = process.env.BOT_TOKEN;
    if (!token) { res.status(200).send("BOT_TOKEN absent des variables."); return; }
    try {
      const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
      if (q.info) {
        const wh = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json();
        res.status(200).json({ bot: me.result?.username || null, token_ok: !!me.ok, webhook_url: wh.result?.url || "", webhook_pending: wh.result?.pending_update_count ?? null });
        return;
      }
      const url = `https://${req.headers.host}/api/telegram`;
      const wh = await (await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) })).json();
      res.status(200).json({ bot: me.result?.username || null, setWebhook: wh });
    } catch (e) { res.status(200).send("Erreur setup: " + e.message); }
    return;
  }
  if (req.method === "POST" && q.push_radar) {
    if (!process.env.RADAR_PUSH_TOKEN || req.headers["x-radar-token"] !== process.env.RADAR_PUSH_TOKEN) { res.status(403).json({ error: "jeton invalide" }); return; }
    try {
      const raw = Array.isArray(req.body?.opps) ? req.body.opps : [];
      const clean = raw.filter(o => o && typeof o.title === "string" && typeof o.deadlineISO === "string").slice(0, 20).map(o => ({ id: String(o.id || "").slice(0, 80), profile: ["concours", "emploi", "etudiant", "entrepreneur"].includes(o.profile) ? o.profile : "emploi", title: o.title.slice(0, 160), org: String(o.org || "").slice(0, 80), deadline: String(o.deadline || "").slice(0, 60), deadlineISO: o.deadlineISO, summary: String(o.summary || "").slice(0, 400), url: String(o.url || "").slice(0, 300) }));
      await store.sync?.().catch(() => {});
      const r = await makeBot().ingestOpps(clean);
      res.status(200).json({ pushed: clean.length, added: r.added, total: r.total });
    } catch (e) { res.status(200).json({ error: e.message }); }
    return;
  }
  if (req.method !== "POST") { res.status(200).send("Baara Bot — en ligne."); return; }
  try { await store.sync?.().catch(() => {}); await makeBot().handleUpdate(req.body || {}); }
  catch (e) { console.error(e); }
  res.status(200).send("ok");
};
