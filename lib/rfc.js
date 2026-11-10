// Client RealFreeCV (API publique v1) — liaison de compte et synchronisation des CV.
// Authentification double : clé API de l'application Baara (X-Api-Key, cfg.rfcApiKey)
// + jeton utilisateur rfcu_ propre à chaque compte lié (jamais journalisé ici).
const DEFAULT_BASE = "https://charming-dove-810.convex.site";
const DESIGN = { templateId: "moderne", primaryColor: "#12283F", fontFamily: "Inter", fontSize: "medium", spacing: "normal" };

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}
function splitContact(contact) {
  const c = String(contact || "");
  const email = (c.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [""])[0];
  const phone = c.replace(email, "").replace(/[·|]/g, " ").replace(/\s+/g, " ").trim();
  return { email, phone };
}
function parseExpLine(line, idx) {
  const raw = String(line || "").trim();
  const item = { id: "exp-" + idx, jobTitle: "", company: "", location: "", startDate: "", endDate: "", current: false, description: raw };
  if (!raw) return item;
  const paren = raw.match(/\(([^)]*)\)/);
  if (paren) {
    const dates = paren[1].split(/\s*[-–—]\s*/);
    item.startDate = (dates[0] || "").trim();
    item.endDate = (dates[1] || "").trim();
    if (/présent|present|actuel|en cours/i.test(paren[1])) item.current = true;
  }
  const head = raw.split(":")[0];
  const segs = head.split(/\s*[—–]\s*/);
  item.jobTitle = (segs[0] || "").replace(/\([^)]*\)/, "").trim().slice(0, 80) || raw.slice(0, 80);
  if (segs[1]) item.company = segs[1].replace(/\([^)]*\)/, "").replace(/,\s*$/, "").trim().slice(0, 80);
  return item;
}
function parseEduLine(line, idx) {
  const raw = String(line || "").trim();
  const segs = raw.split(/\s*[—–,]\s*/);
  return { id: "edu-" + idx, degree: (segs[0] || raw).slice(0, 90), school: (segs.slice(1).join(", ") || "").slice(0, 90), location: "", startDate: "", endDate: "", description: raw };
}
function cvToResume(cv, telegramId, suffix) {
  const now = new Date().toISOString();
  const { firstName, lastName } = splitName(cv.name);
  const { email, phone } = splitContact(cv.contact);
  const expLines = String(cv.expRaw || "").split(/\n+/).map(x => x.trim()).filter(Boolean);
  const eduLines = String(cv.eduRaw || "").split(/\n+/).map(x => x.trim()).filter(Boolean);
  const skills = (Array.isArray(cv.skills) && cv.skills.length ? cv.skills : String(cv.skillsRaw || "").split(",").map(x => x.trim()).filter(Boolean));
  const langs = String(cv.langRaw || "").split(",").map(x => x.trim()).filter(Boolean).map((x, i) => {
    const m = x.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return { id: "lang-" + i, name: m ? m[1].trim() : x, level: m ? m[2].trim() : "" };
  });
  return {
    id: "baara-" + telegramId + (suffix ? "-" + suffix : ""),
    title: cv.title ? "CV — " + cv.title : "Mon CV (Baara)",
    createdAt: now, updatedAt: now, locale: "fr",
    personal: { firstName, lastName, title: cv.title || "", email, phone, city: cv.city || "", country: "", summary: cv.summary || "" },
    experiences: expLines.map((l, i) => parseExpLine(l, i)),
    educations: eduLines.map((l, i) => parseEduLine(l, i)),
    skills: skills.map((name, i) => ({ id: "skill-" + i, name })),
    languages: langs,
    certifications: [], projects: [], interests: [],
    design: Object.assign({}, DESIGN),
  };
}
function resumeToCv(r) {
  const p = r.personal || {};
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  const contact = [p.email, p.phone].filter(Boolean).join(" · ");
  const expRaw = (r.experiences || []).map(e => {
    const head = [e.jobTitle, e.company].filter(Boolean).join(" — ");
    const dates = (e.startDate || e.endDate) ? " (" + [e.startDate, e.current ? "Présent" : e.endDate].filter(Boolean).join(" - ") + ")" : "";
    return (head + dates + (e.description && e.description !== head ? " : " + e.description : "")).trim();
  }).filter(Boolean).join("\n");
  const eduRaw = (r.educations || []).map(e => [e.degree, e.school].filter(Boolean).join(" — ")).filter(Boolean).join("\n");
  const skills = (r.skills || []).map(s => s.name).filter(Boolean);
  const langRaw = (r.languages || []).map(l => l.level ? l.name + " (" + l.level + ")" : l.name).join(", ");
  return { name, title: p.title || "", contact, city: p.city || "", summary: p.summary || "", expRaw, eduRaw, skills, skillsRaw: skills.join(", "), langRaw };
}

function createRfcClient(cfg) {
  const base = (cfg && cfg.rfcBase) || DEFAULT_BASE;
  const apiKey = (cfg && cfg.rfcApiKey) || "";
  async function call(method, path, opts) {
    opts = opts || {};
    if (!apiKey) return { ok: false, error: "no_api_key", message: "Clé API RealFreeCV non configurée côté Baara." };
    try {
      const headers = { "Content-Type": "application/json", "X-Api-Key": apiKey };
      if (opts.userToken) headers["X-User-Token"] = opts.userToken;
      const r = await fetch(base + path, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.error) return { ok: false, error: (j && j.error && j.error.code) || ("http_" + r.status), message: (j && j.error && j.error.message) || "Réponse inattendue de RealFreeCV." };
      return { ok: true, data: j };
    } catch (e) { return { ok: false, error: "network", message: "RealFreeCV injoignable (" + e.message + ")." }; }
  }
  return {
    configured: () => !!apiKey,
    exchange: (code) => call("POST", "/api/v1/link/exchange", { body: { code } }),
    me: (userToken) => call("GET", "/api/v1/me", { userToken }),
    listResumes: (userToken) => call("GET", "/api/v1/me/resumes", { userToken }),
    getResume: (userToken, appId) => call("GET", "/api/v1/me/resumes/one?appId=" + encodeURIComponent(appId), { userToken }),
    pushResume: (userToken, resume) => call("POST", "/api/v1/me/resumes", { userToken, body: { resume } }),
  };
}
module.exports = { createRfcClient, cvToResume, resumeToCv, DEFAULT_BASE };
