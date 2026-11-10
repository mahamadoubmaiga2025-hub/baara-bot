// Catalogue des services Premium Baara — PRIX ÉDITABLES ICI (jamais en dur ailleurs).
// Montants en FCFA. Objectif business : 5 850 FCFA nets/jour.
const SERVICES = {
  pack: {
    label: "Pack CV + Lettre",
    emoji: "⭐",
    price: 4500,
    desc: "LE pack complet pour une offre précise : ton CV réécrit et adapté à l'offre + ta lettre de motivation personnalisée. 2 PDF livrés après validation du paiement. Sans limite d'achat.",
  },
  cvpro: {
    label: "CV pro adapté",
    emoji: "🎯",
    price: 3500,
    desc: "Ton CV réécrit pour un poste ou un secteur que tu vises (résumé et titre retravaillés par l'IA, sans rien inventer). PDF livré après validation du paiement.",
  },
  cvopt: {
    label: "CV optimisé ATS",
    emoji: "⚡",
    price: 2000,
    desc: "Correction et optimisation de ton CV pour les logiciels de tri (ATS) : résumé renforcé, compétences nettoyées et ordonnées par pertinence. PDF livré après validation du paiement.",
  },
  entretien: {
    label: "Simulation d'entretien premium",
    emoji: "🎤",
    price: 2000,
    desc: "Session complète : 6 questions adaptées à l'offre, correction détaillée de chaque réponse (note, points forts, points faibles, exemple de meilleure formulation) et bilan final.",
  },
  transcription: {
    label: "Transcription longue",
    emoji: "🎙️",
    price: 500,
    desc: "Transcription intégrale d'un message vocal long : 500 F CFA jusqu'à 10 minutes, puis 50 F CFA par minute supplémentaire. Envoie simplement ton vocal au bot pour obtenir le prix exact.",
  },
  doc: {
    label: "Document sur mesure",
    emoji: "📝",
    price: 1500,
    desc: "Rapport, lettre administrative, devis ou autre document formel : un court questionnaire, et tu reçois un PDF propre, prêt à signer.",
  },
};
const TRANSCRIPTION_INCLUDED_MIN = 10;
const TRANSCRIPTION_PER_MIN = 50;
function transcriptionPrice(durationSec) {
  const min = (durationSec || 0) / 60;
  if (min <= TRANSCRIPTION_INCLUDED_MIN) return SERVICES.transcription.price;
  return SERVICES.transcription.price + TRANSCRIPTION_PER_MIN * Math.ceil(min - TRANSCRIPTION_INCLUDED_MIN);
}
const DAILY_GOAL = 5850;
module.exports = { SERVICES, transcriptionPrice, DAILY_GOAL };
