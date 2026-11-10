#!/usr/bin/env bash
# Installation de Baara sur la VM Boxd — à lancer depuis le dossier boxd/ du dépôt cloné.
set -e
cd "$(dirname "$0")/.."
mkdir -p data
if [ ! -f .env ]; then cp boxd/.env.example .env; echo "Fichier .env créé — remplis BOT_TOKEN (BotFather), puis relance ce script."; exit 0; fi
if ! grep -q "^BOT_TOKEN=." .env; then echo "BOT_TOKEN est vide dans .env — mets le token du bot Baara, puis relance."; exit 1; fi
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then echo "Node.js introuvable sur cette VM — installe-le (sudo apt-get install -y nodejs) puis relance."; exit 1; fi
sed "s|^ExecStart=.*|ExecStart=$NODE_BIN $(pwd)/server.js|" boxd/baara.service > boxd/baara.service.local
sudo cp boxd/baara.service.local /etc/systemd/system/baara.service
sudo systemctl daemon-reload
sudo systemctl enable --now baara
sleep 1
systemctl --no-pager status baara | head -10
echo "--- Test local du stockage ---"
curl -s "http://127.0.0.1:8000/?storecheck=1" || true
echo
echo "OK. Ouvre ensuite https://good-cave.boxd.sh/?setup=1 pour brancher le webhook Telegram."
