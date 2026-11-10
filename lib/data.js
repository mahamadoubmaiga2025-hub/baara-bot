// Données Baara — profils et offres de départ (vérifiées le 03/11/2026, mêmes sources que le Radar FasoTech).
// Les offres expirées sont filtrées automatiquement à l'affichage ; le relais MaliPages en ajoute via ?push_radar=1.
const PROFILES = [
  { id: "emploi", label: "💼 Chercheur d'emploi" },
  { id: "concours", label: "🏆 Candidat concours" },
  { id: "etudiant", label: "🎓 Étudiant / stagiaire" },
  { id: "entrepreneur", label: "🚀 Entrepreneur / appels à projets" },
];

const OPPORTUNITIES = [
  { id: "fp-2026", deadlineISO: "2026-11-13", profile: "concours", title: "Concours directs Fonction publique d'État 2026 — 1 122 postes (catégories A, B2, B1, C)", org: "Ministère du Travail / CNCFP", deadline: "Vendredi 13 novembre 2026 à 16h", summary: "Dépôt des dossiers au Centre national des Concours (Bamako) et auprès des Gouverneurs de Kayes, Sikasso, Ségou, Mopti, Tombouctou, Gao et Koutiala. Épreuves du 9 au 24 janvier 2027." },
  { id: "fongim-2026", deadlineISO: "2026-11-20", profile: "emploi", title: "Coordinateur(trice) exécutif(ve) intérimaire (remplacement janv.–mars 2027)", org: "FONGIM — Forum des ONG Internationales au Mali", deadline: "Vendredi 20 novembre 2026 à 12h (Bamako)", summary: "Candidature par e-mail uniquement : ml.recrutement@fongim.org — objet « Intérim – Coordinateur(trice) Exécutif(ve) FONGIM ». Recrutement entièrement gratuit." },
  { id: "nrc-fin-2026", deadlineISO: "2026-11-16", profile: "emploi", title: "Finance Manager — Bamako (CDD 12 mois renouvelable, Grade 9)", org: "NRC — Conseil norvégien pour les réfugiés", deadline: "Lundi 16 novembre 2026", summary: "Candidature en ligne sur le portail de recrutement de NRC, CV en français ou en anglais." },
  { id: "crs-ops-2026", deadlineISO: "2026-11-15", profile: "emploi", title: "Directeur(trice) des Opérations (Head of Operations) — Bamako", org: "CRS — Catholic Relief Services Mali", deadline: "Dimanche 15 novembre 2026", summary: "Avis CRSMLI/011/2026. Expérience en ONG internationale fortement souhaitée. Candidature via CRS Careers (voir malipages.com)." },
  { id: "mrhc-2026", deadlineISO: "2026-11-12", profile: "emploi", title: "Responsable Financier Pays Senior + Chargé(e) Senior PMEAL — Bamako (2 postes)", org: "Mali RH Consulting (pour un client ONG)", deadline: "Jeudi 12 novembre 2026 à 17h", summary: "Dossiers par e-mail à recrut.mrhc@gmail.com avec l'intitulé du poste en objet. Tri au fur et à mesure : n'attends pas la date limite." },
];

module.exports = { PROFILES, OPPORTUNITIES };
