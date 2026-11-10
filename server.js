// Baara — serveur autonome pour VM Boxd (Node pur, aucune dépendance).
// Sert le handler (api.js) sur le port 8000 (adresse publique https://good-cave.boxd.sh)
// et lance la maintenance (alertes deadlines) toutes les heures en interne.
const fs = require("fs");
const path = require("path");
const http = require("http");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!process.env.FILE_STORE_PATH) process.env.FILE_STORE_PATH = path.join(__dirname, "data", "state.json");

const handler = require("./api");
const PORT = Number(process.env.PORT || 8000);

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch (e) { body = {}; } }
    const u = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const query = {};
    u.searchParams.forEach((v, k) => { query[k] = v; });
    const vReq = { method: req.method, query, body, headers: req.headers };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { if (!res.headersSent) res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
    res.send = (text) => { if (!res.headersSent) res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end(String(text)); };
    try { await handler(vReq, res); }
    catch (e) { console.error(e); if (!res.writableEnded) { res.statusCode = 200; res.end("ok"); } }
  });
});
server.listen(PORT, "0.0.0.0", () => console.log("Baara en écoute sur le port " + PORT));

// Maintenance interne : alertes de deadlines (le handler recharge l'état à chaque appel).
setInterval(() => {
  fetch("http://127.0.0.1:" + PORT + "/?housekeeping=1").catch(() => {});
}, 60 * 60 * 1000);
