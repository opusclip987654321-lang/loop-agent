# Loop Agent

Le visuel des boucles des projets de Walid : ce que chaque agent fait, mesure,
apprend, et ce qui attend une décision. Règles : `CADRAGE-ATELIER.md`.

- Adresse prévue : https://loopagent.actualitevideo.fr
- Serveur : VPS YouTube automatisation (`ssh loop-agent-vps`), dossier `/opt/loop-agent`
- Aucun appel payant à l'API Claude : les agents écrivent dans Loop Agent quand Claude tourne.

## Organisation

| Dossier | Rôle |
|---|---|
| `server/` | Serveur Node.js sans dépendance : connexion, documents versionnés (SQLite), factures |
| `public/` | Interface (reprise de la maquette). `boot.js` charge les données, `glue.js` raccorde au serveur |
| `test/` | Tests du serveur (`npm test`) |
| `atelier-maquette.html` | Maquette d'origine, gardée comme référence |

Chaque projet, et la page Argent, est **un document JSON versionné**. Une écriture
annonce la version qu'elle a lue ; si un agent a écrit entre-temps, elle est refusée
(409) et la page recharge la version de l'agent. La page vérifie toutes les 20 s si
un agent a écrit.

## En local

```sh
npm run hash-password          # choisir un mot de passe, copier la ligne dans .env
npm run dev                    # http://localhost:3000
npm test
```

## Sur le serveur (première installation)

Chaque étape se fait avec l'accord de Walid.

1. Clé GitHub en lecture seule pour ce dépôt (« deploy key »), puis
   `git clone git@github.com:opusclip987654321-lang/loop-agent.git /opt/loop-agent`
2. `cd /opt/loop-agent && cp .env.example .env && chmod 600 .env`
3. Walid génère l'empreinte de son mot de passe et la colle dans `.env` :
   `docker compose run --rm --no-deps loop-agent node scripts/hash-password.js`
4. `docker compose up -d --build`, puis vérifier :
   `docker compose ps` (état « healthy »)
5. Caddy : sauvegarde de `/opt/n8n/Caddyfile`, ajout du bloc ci-dessous, vérification,
   rechargement, puis contrôle que `n8n.actualitevideo.fr` répond toujours :

   ```
   loopagent.actualitevideo.fr {
       reverse_proxy loop-agent:3000
   }
   ```

   ```sh
   docker exec n8n-caddy-1 caddy validate --config /etc/caddy/Caddyfile
   docker exec n8n-caddy-1 caddy reload --config /etc/caddy/Caddyfile
   ```

## Mise à jour

```sh
cd /opt/loop-agent && git pull && docker compose up -d --build
```

Si la nouvelle version ne démarre pas (`docker compose ps` n'affiche pas « healthy ») :
`git checkout <version précédente> && docker compose up -d --build`.

## Relancer les agents après une décision

Pour un projet dont l'agent tourne en routine (claude.ai/code/routines) : ouvrir la routine, **Add another trigger → API → Generate token**, garder la page ouverte, puis sur le serveur :

```sh
ssh -t loop-agent-vps 'docker exec -it loop-agent node scripts/routine-jeton.js ranger <projet>'
```

Le script demande l'adresse puis le jeton (masqué). Ils sont rangés dans `/data/routines.json` (droits 600), jamais dans le code. `liste` montre les projets branchés, `retirer <projet>` en débranche un. Pas besoin de redémarrer. Garde-fou : une relance par projet toutes les 30 minutes au plus (`ROUTINE_COOLDOWN_MINUTES`).

## Surveillance des sites

Toutes les 5 minutes, Loop Agent vérifie les sites (nourmeet.com et son API, leviaro.fr et son admin, vegebudget.fr, les deux n8n, le cerveau), leurs certificats HTTPS et son propre disque (`server/surveillance.js`). Un site qui rate est revérifié 30 s plus tard ; une seule alerte Telegram par panne, puis « rétabli » avec la durée. État dans `/data/surveillance.json`. `SURVEILLANCE=0` dans `.env` pour la couper. Reprise du cerveau central (novembre 2026).

## Rappels Argent

Sur Telegram, à partir de 9 h (Paris) : un abonnement qui se renouvelle dans 3 jours ou moins (une fois par échéance), et le 1er du mois le total du mois fini, par devise et par projet (`server/argent-rappels.js`, mêmes calculs que la page Argent). Reprise du résumé du matin du cerveau central.

## Données

Volume Docker `loop-agent_loop_agent_data` : `loop-agent.sqlite` (tout) et `files/` (factures).
Sauvegardes de nuit et copie vers le Mac : étape 3.
