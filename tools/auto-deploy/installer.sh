#!/usr/bin/env bash
# Installe la mise à jour automatique (mise-a-jour-auto.sh) sur un serveur. À lancer une fois :
#   bash ~/auto-deploy/installer.sh serveur-nour     (57.131.152.36 : sponsors, agent et site Leviaro, Nūr Meet)
#   bash ~/auto-deploy/installer.sh serveur-loop     (51.255.174.30 : Loop Agent)
# Ne change aucun fichier déjà présent dans les dossiers des projets : il ajoute seulement git
# (s'il manque) et les fichiers du dépôt absents du serveur. Une différence est affichée, jamais écrasée.
set -uo pipefail
OWNER=opusclip987654321-lang
BASE="$HOME/auto-deploy"
CONF="$BASE/projets.conf"
mkdir -p "$BASE"; touch "$CONF"
A_FAIRE=()

dossier_du_conteneur() { # motif de nom de conteneur
  local c; c=$(docker ps --format '{{.Names}}' | grep -E "$1" | head -1)
  [ -n "$c" ] && docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$c"
}

url_modele() { # dépôt
  local ref=""
  [ -d /opt/vegebudget/.git ] && ref=$(git -C /opt/vegebudget remote get-url origin 2>/dev/null)
  case "$ref" in
    git@*|ssh://*) echo "git@github.com:$OWNER/$1.git" ;;
    https://*@github.com/*) echo "$ref" | sed -E "s#/[^/]+/[^/]+(\.git)?\$#/$OWNER/$1.git#" ;;
    *) echo "git@github.com:$OWNER/$1.git" ;;
  esac
}

cle_deploiement() { # dépôt dossier
  local k="$HOME/.ssh/deploy_$1"
  [ -f "$k" ] || ssh-keygen -q -t ed25519 -N "" -C "auto-deploy $1 $(hostname)" -f "$k"
  if ! grep -q "^Host github-$1\$" "$HOME/.ssh/config" 2>/dev/null; then
    printf '\nHost github-%s\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$1" "$k" >> "$HOME/.ssh/config"
    chmod 600 "$HOME/.ssh/config"
  fi
  git -C "$2" remote set-url origin "git@github-$1:$OWNER/$1.git"
  ssh-keyscan -q github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null
}

brancher() { # nom dépôt dossier
  local nom="$1" depot="$2" dir="$3"
  echo "== $nom ($dir)"
  [ -n "$dir" ] && [ -d "$dir" ] || { echo "   introuvable, ignoré"; A_FAIRE+=("$nom : dossier introuvable"); return; }
  local neuf=0
  if [ ! -d "$dir/.git" ]; then
    git -C "$dir" init -q -b main && git -C "$dir" remote add origin "$(url_modele "$depot")"; neuf=1
  fi
  if ! GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" git -C "$dir" fetch -q origin main 2>/dev/null; then
    cle_deploiement "$depot" "$dir"
    if ! git -C "$dir" fetch -q origin main 2>/dev/null; then
      echo "   accès GitHub manquant. Clé à ajouter (lecture seule) sur https://github.com/$OWNER/$depot/settings/keys :"
      echo "   $(cat "$HOME/.ssh/deploy_$depot.pub")"
      A_FAIRE+=("$nom : ajouter la clé ci-dessus puis relancer l'installateur")
      return
    fi
  fi
  if [ "$neuf" = 1 ]; then
    git -C "$dir" reset -q origin/main               # le dépôt devient la référence, sans toucher aux fichiers
    local manquants; manquants=$(git -C "$dir" ls-files --deleted)
    [ -n "$manquants" ] && git -C "$dir" checkout -- $manquants && echo "   ajoutés (absents du serveur) : $(echo $manquants)"
  fi
  local diff; diff=$(git -C "$dir" status --porcelain --untracked-files=no)
  if [ -n "$diff" ]; then
    echo "   DIFFÉRENCES avec GitHub (rien n'est écrasé ; la mise à jour auto attend qu'elles soient réglées) :"
    git -C "$dir" diff --stat | sed 's/^/     /'
    A_FAIRE+=("$nom : fichiers différents de GitHub")
  else
    echo "   OK : identique à GitHub ($(git -C "$dir" rev-parse --short HEAD))"
  fi
  grep -q "^$nom " "$CONF" || echo "$nom $dir" >> "$CONF"
}

case "${1:-}" in
  serveur-nour)
    brancher impacteur-sponsors impacteur-sponsors "$(dossier_du_conteneur '^impacteur-sponsors$')"
    brancher leviaro-agent leviaro-agent "$(dossier_du_conteneur '^leviaro.*(web|cycle)')"
    brancher leviaro-site leviaro-site "$(dossier_du_conteneur '^leviaro-site$')"
    brancher nour-meet nour-meet "$(dossier_du_conteneur '^nour.*api')"
    ;;
  serveur-loop) brancher loop-agent loop-agent /opt/loop-agent ;;
  *) echo "Usage : installer.sh serveur-nour|serveur-loop"; exit 1 ;;
esac

chmod +x "$BASE/mise-a-jour-auto.sh"
if ! crontab -l 2>/dev/null | grep -q 'auto-deploy/mise-a-jour-auto.sh'; then
  { crontab -l 2>/dev/null; echo "*/10 * * * * bash $BASE/mise-a-jour-auto.sh # mise a jour auto des projets"; } | crontab -
fi
echo
echo "Projets suivis :"; sed 's/^/  /' "$CONF"
echo "Mise à jour automatique : toutes les 10 minutes. Journal : $BASE/journal.log"
if [ ${#A_FAIRE[@]} -gt 0 ]; then echo; echo "RESTE À FAIRE :"; printf '  - %s\n' "${A_FAIRE[@]}"; else echo "Tout est prêt."; fi
