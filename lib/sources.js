// Sources automatiques du Radar — récupération d'offres d'emploi RÉELLES avec deadlines affichées.
// MaliPages (vérifié le 04/11/2026) : les listes affichent titre, entreprise, lieu et « Date limite: JJ/MM/AAAA ».
// Règle héritée du Radar manuel : aucune offre sans deadline, aucune offre expirée.

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const stripTags = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").replace(/&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const todayISO = () => new Date().toISOString().slice(0, 10);

function catToProfile(slug) {
  const s = String(slug || "").toLowerCase();
  if (s.includes("stage")) return "etudiant";
  if (s.includes("concours")) return "concours";
  if (s.includes("entrepren") || s.includes("appel")) return "entrepreneur";
  return "emploi";
}

async function fetchMalipages(fetchImpl) {
  const f = fetchImpl || fetch;
  const r = await f("https://www.malipages.com/emplois/", { headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G986B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "fr-FR,fr;q=0.9" } });
  if (!r.ok) throw new Error("MaliPages HTTP " + r.status);
  const html = await r.text();
  const blocks = html.split(/<li\s+class="list-item/).slice(1, 40);
  const out = [];
  for (const blk of blocks) {
    const tm = blk.match(/list-item-title"[^>]*>\s*<a\s+href="([^"]+)">([^<]+)<\/a>/);
    const em = blk.match(/list-item-expires"[^>]*>Date limite:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (!tm || !em) continue; // pas de deadline affichée -> on ne charge pas
    const url = tm[1], title = stripTags(tm[2]);
    const iso = `${em[3]}-${em[2]}-${em[1]}`;
    if (iso < todayISO()) continue; // expirée
    const cm = blk.match(/list-item-company"[^>]*>([^<]+)</);
    const lm = blk.match(/list-item-location"[^>]*>([^<]+)</);
    const km = blk.match(/job_listing_category-([a-z0-9-]+)/);
    out.push({
      id: "mp-" + url.replace(/[^a-z0-9]+/gi, "-").slice(-60),
      source: "malipages",
      profile: catToProfile(km && km[1]),
      title,
      org: cm ? stripTags(cm[1]) : "MaliPages",
      deadline: `${Number(em[1])} ${MONTHS_FR[Number(em[2]) - 1]} ${em[3]}`,
      deadlineISO: iso,
      summary: `${lm ? "📍 " + stripTags(lm[1]) + " — " : ""}Offre publiée sur MaliPages. Détails et dépôt de candidature : ${url}`,
      url,
    });
  }
  out.sort((a, b) => (a.deadlineISO < b.deadlineISO ? -1 : 1));
  return out.slice(0, 12);
}

const SOURCES = [{ id: "malipages", label: "MaliPages", fetch: fetchMalipages }];
module.exports = { SOURCES, fetchMalipages, todayISO };
