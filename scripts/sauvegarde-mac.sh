#!/bin/bash
# Copie sur le Mac les sauvegardes faites chaque nuit par le serveur.
# Lancé chaque matin par launchd (voir scripts/fr.loopagent.sauvegarde.plist).
# Destination : ~/Sauvegardes/loop-agent  (14 bases + factures, comme sur le serveur).
set -euo pipefail
DEST="$HOME/Sauvegardes/loop-agent"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# Le dossier backups vit dans le volume Docker : on l'archive depuis le conteneur.
ssh -o BatchMode=yes -o ConnectTimeout=20 loop-agent-vps \
  'docker exec loop-agent tar -C /data -cf - backups' > "$TMP/backups.tar"
tar -C "$TMP" -xf "$TMP/backups.tar"
rsync -a --delete "$TMP/backups/" "$DEST/"
echo "$(date '+%F %T') sauvegardes copiées : $(ls "$DEST" | grep -c '\.sqlite$') bases" >> "$DEST/../loop-agent-copies.log"
