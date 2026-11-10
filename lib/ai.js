// Baara — accès IA : Vycea en cascade (deepseek-v4.1 -> agnes-3.0-flash), repli Gemini.
// Sans clé configurée, toutes les fonctions rendent null et le bot reste en mode déterministe.
function vyceaModels() {
  return (process.env.VYCE_MODELS || "deepseek-v4.1,agnes-3.0-flash").split(",").map(s => s.trim()).filter(Boolean);
}
async function callVycea(messages, maxTokens) {
  const key = process.env.VYCE_API_KEY;
  if (!key) return null;
  const base = process.env.VYCE_BASE_URL || "https://vyceai.com/v1";
  for (const model of vyceaModels()) {
    try {
      const r = await fetch(base + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify({ model, messages, max_tokens: maxTokens || 700, temperature: 0.4 }) });
      if (!r.ok) continue;
      const j = await r.json();
      const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (text) return String(text);
    } catch (e) { /* modèle suivant */ }
  }
  return null;
}
function geminiModels() {
  return (process.env.GEMINI_MODELS || "gemini-3.6-flash,gemini-3.5-flash,gemini-3.8-flash").split(",").map(x => x.trim()).filter(Boolean);
}
async function callGemini(parts, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  for (const model of geminiModels()) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + key, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens || 700, temperature: 0.4 } }) });
      if (!r.ok) continue;
      const j = await r.json();
      const cand = j && j.candidates && j.candidates[0];
      const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || "").join("") : "";
      if (text) return text;
    } catch (e) { /* modèle suivant */ }
  }
  return null;
}
// Texte libre -> texte (ou null si aucune IA)
async function aiText(prompt, maxTokens) {
  const viaVycea = await callVycea([{ role: "user", content: prompt }], maxTokens);
  if (viaVycea) return viaVycea;
  return callGemini([{ text: prompt }], maxTokens);
}
// Document/image/audio (base64) + consigne -> texte (Gemini multimodal ; Vycea texte seul ne le fait pas)
async function aiMedia(base64, mimeType, prompt, maxTokens) {
  return callGemini([{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }], maxTokens || 1200);
}
function aiAvailable() { return !!(process.env.VYCE_API_KEY || process.env.GEMINI_API_KEY); }
function parseJsonLoose(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}
module.exports = { aiText, aiMedia, aiAvailable, parseJsonLoose };
