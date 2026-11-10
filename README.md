# Baara — assistant Telegram « Emploi & CV » du Mali

« Baara » = le travail, en bambara. Un bot Telegram centré sur une seule promesse :
**aider à décrocher un emploi ou un concours, sans se faire arnaquer.**

## Ce que fait le bot (V1)

- **Profils** : chercheur d'emploi, candidat concours, étudiant/stagiaire, entrepreneur.
- **Radar d'offres vérifiées** : offres et concours du Mali filtrés par profil, triés par
  date limite, expirés retirés automatiquement ; sources : sélection vérifiée à la main +
  relais MaliPages (endpoint signé `?push_radar=1`).
- **Mon CV** : création guidée en 8 questions → PDF professionnel immédiat
  (moteur PDF maison, design RealFreeCV), sauvegardé dans le bot.
- **CV adapté** : sous chaque offre, un score d'adéquation /100 (mots-clés de l'offre
  présents/absents dans le CV, avec avertissement d'honnêteté) + un PDF adapté à l'offre.
  Limite : 3 adaptations/jour/utilisateur.
- **Anti-arnaque** : l'utilisateur colle une offre reçue ; analyse locale par signaux
  (frais demandés, code PIN, urgence fabriquée, e-mail gratuit, gains irréalistes…)
  → verdict 🔴/🟠/🟢 et règles d'or. Aucun appel externe.
- **Alertes** : rappel automatique 3 jours avant la date limite des offres du profil
  (maintenance interne toutes les heures) + alerte à chaque nouvelle offre du relais.
- **Admin** (ADMIN_ID) : statistiques et ajout d'offre au format
  `Titre | profil | AAAA-MM-JJ | Organisation | Résumé`.

## Architecture

Node.js pur, **zéro dépendance**. Serveur HTTP maison (`server.js`) → handler
(`api.js`) → cœur (`lib/bot.js`). Stockage : fichier JSON local (`lib/store.js`,
FileStore, écriture atomique) sur le disque persistant de la VM Boxd — aucun service
de stockage externe, donc aucun quota à épuiser.

## Installation sur Boxd

```bash
git clone https://github.com/mahamadoubmaiga2025-hub/baara-bot.git
cd baara-bot
bash boxd/install.sh     # crée .env, puis s'arrête
nano .env                # BOT_TOKEN (BotFather) — BOT_USERNAME et ADMIN_ID sont pré-remplis
bash boxd/install.sh     # installe le service systemd et démarre
```

Puis ouvrir https://good-cave.boxd.sh/?setup=1 (branche le webhook Telegram).

## Tests

```bash
node test/simulate.js
```

Parcours complet simulé : accueil + profil, radar, création de CV et adaptation (PDF),
anti-arnaque (offre frauduleuse flaguée, offre propre non flaguée), alertes, relais.
