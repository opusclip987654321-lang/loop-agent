#!/usr/bin/env bash
# Mise à jour automatique des projets de Walid (décision de Walid du 10/11/2026 :
# « l'agent installe la PR seul, je dois juste comprendre l'idée et le contexte »).
# Même méthode que vegebudget (scripts/mise-a-jour-auto.sh du dépôt v-g-budget).
#
# Lancé toutes les 10 minutes par cron. Pour chaque projet de ~/auto-deploy/projets.conf :
# ne fait rien tant que main n'a pas bougé sur GitHub. Sinon : avance sur origin/main,
# reconstruit, vérifie que le service répond, et revient tout seul à la version d'avant
# s'il ne répond pas (la version refusée n'est plus retentée). S'arrête sans rien toucher
# si un fichier suivi a été modifié à la main sur le serveur.
# Journal : ~/auto-deploy/journal.log (une ligne par mise à jour, réussie ou non).
set -uo pipefail

main() {
  local base="$HOME/auto-deploy" conf="$HOME/auto-deploy/projets.conf" log="$HOME/auto-deploy/journal.log"
  note() { echo "$(date '+%F %T') [$1] $2" >> "$log"; }

  exec 9>"$base/.verrou"
  flock -n 9 || return 0
  [ -f "$conf" ] || return 0

  while read -r nom dir; do
    case "$nom" in ''|'#'*) continue;; esac
    ( maj "$nom" "$dir" ) || true
  done < "$conf"
}

deployer() {
  case "$1" in
    nour-meet) ./scripts/deploy.sh production ;;
    leviaro-site) docker compose up -d && docker compose restart ;;
    *) docker compose up -d --build ;;
  esac
}

sante() {
  local i
  for i in $(seq 1 30); do
    case "$1" in
      impacteur-sponsors) docker exec impacteur-sponsors wget -qO- http://127.0.0.1:8790/sante 2>/dev/null | grep -q '"ok":true' && return 0 ;;
      leviaro-agent)
        local c; c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8787/ || true)
        [ -n "$c" ] && [ "$c" != 000 ] && [ "$c" -lt 500 ] && [ "$(docker compose ps --status running -q | wc -l)" -ge 2 ] && return 0 ;;
      leviaro-site) curl -fsS -o /dev/null --max-time 10 https://leviaro.fr/ && return 0 ;;
      nour-meet) curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:4000/health && return 0 ;;
      loop-agent) [ "$(docker inspect -f '{{.State.Health.Status}}' loop-agent 2>/dev/null)" = healthy ] && return 0 ;;
      *) return 0 ;;
    esac
    sleep 5
  done
  return 1
}

revenir() { # nom ancien
  if [ "$1" = nour-meet ]; then
    ./scripts/rollback.sh production "$2"
  else
    git reset -q --hard "$2" && deployer "$1"
  fi
}

maj() {
  local nom="$1" dir="$2" log="$HOME/auto-deploy/journal.log" bad="$HOME/auto-deploy/.refusee-$1"
  note() { echo "$(date '+%F %T') [$nom] $*" >> "$log"; }
  cd "$dir" 2>/dev/null || { note "Dossier $dir introuvable."; return 1; }
  git fetch -q origin main 2>>"$log" || { note "git fetch impossible (accès GitHub ?)."; return 1; }
  # Fichier changé à la main mais déjà identique à la version de GitHub (ex. la modif a été recopiée
  # dans le dépôt) : ce n'est pas un conflit, on le remet au niveau de git et on continue.
  local f modifs; modifs=$(git diff --name-only HEAD 2>/dev/null)
  if [ -n "$modifs" ] && git diff --quiet origin/main -- $modifs 2>/dev/null; then
    note "Fichiers déjà identiques à GitHub, repris par git : $(echo $modifs)"
    git checkout -q HEAD -- $modifs
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    local stamp="$HOME/auto-deploy/.modif-$nom"
    if [ "$(date +%F)" != "$(cat "$stamp" 2>/dev/null)" ]; then
      note "ARRÊT : fichiers modifiés à la main sur le serveur : $(git status --porcelain --untracked-files=no | tr '\n' ' '). Rien n'est mis à jour."
      date +%F > "$stamp"
    fi
    return 1
  fi
  local old new
  old=$(git rev-parse HEAD); new=$(git rev-parse origin/main)
  [ "$old" = "$new" ] && return 0
  if [ -f "$bad" ] && [ "$(cat "$bad")" = "$new" ]; then return 0; fi

  note "Mise à jour ${old:0:7} -> ${new:0:7}"
  if [ "$nom" != nour-meet ]; then
    git merge -q --ff-only origin/main || { note "ARRÊT : impossible d'avancer jusqu'à origin/main."; return 1; }
  fi
  if deployer "$nom" >> "$log" 2>&1 && sante "$nom"; then
    note "OK : en ligne en ${new:0:7}."
    rm -f "$bad"; docker image prune -f > /dev/null 2>&1
  else
    note "ÉCHEC en ${new:0:7} : retour à ${old:0:7}."
    echo "$new" > "$bad"
    if revenir "$nom" "$old" >> "$log" 2>&1 && sante "$nom"; then note "Version ${old:0:7} remise en ligne."; else note "ALERTE : la version ${old:0:7} ne répond pas non plus."; fi
    return 1
  fi
}

main "$@"; exit $?
