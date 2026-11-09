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

## Mails urgents

Chaque heure, Loop Agent appelle l'automatisation n8n « CERVEAU - lecture des boîtes » (6 boîtes Gmail, 3 derniers jours, lecture seule), trie par règles sans IA (`server/boites.js`, mêmes règles que le cerveau) et envoie chaque mail urgent une seule fois sur Telegram. L'adresse secrète de l'automatisation est dans `/data/boites.json` (droits 600), rangée par `scripts/boites-adresse.js ranger` (lue sur l'entrée standard, jamais affichée) ; `essai` affiche seulement des comptes.

## Méthode de la loop Nūr Meet

Les workflows n8n « Nour Meet 1 » (9 h, repêchage 11 h 07) et « Nour Meet 3 » (9 h 30) lisent chaque matin la méthode (textes, recherches, relances, mails par jour) à une adresse secrète servie par Loop Agent (`/loop/nour-meet/<secret>`, sans connexion), au même format que le cerveau central. Si elle ne répond pas, n8n repart sur ses textes d'origine : rien ne s'arrête. Fichier `/data/nour-methode.json` (droits 600 : secret, méthode, historique). `node scripts/nour-methode.js voir | adresse | importer | revenir <v>`.

## Relevé de la prospection Nūr Meet

Chaque heure, `scripts/nour-meet-releve.py` (installé sur le VPS Nūr dans `~/outils/nour-releve/`, cron) lit les tableaux n8n np_* en lecture seule avec la clé n8n restée sur ce serveur, calcule seulement des chiffres (premiers mails, relances, échecs, ouvertures, réponses, découverts, versions) et les envoie à `POST /releve/nour-meet` avec un jeton (`scripts/releve-jeton.js creer`, seule l'empreinte est gardée). Loop Agent remplit les indicateurs « contactés » (somme du jour) et « taux d'ouverture » (7 jours glissants) du projet nourmeet ; un relevé du même jour remplace le précédent.

## Compte rendu SEO

Chaque dimanche à partir de 8 h (Paris), Loop Agent contrôle nourmeet.com, vegebudget.fr et leviaro.fr comme Google, sans IA (`server/seo.js`, mêmes 17 contrôles et poids que le cerveau central) : note sur 100, actions possibles par importance. Le résultat est rangé dans chaque projet (26 semaines), lisible par les agents dans `lire_projet` (champ `seo`), et résumé sur Telegram.

## Relevé de vegebudget.fr

Chaque heure, Loop Agent lit `https://vegebudget.fr/api/stats` (jeton dans `/data/vegebudget.json`, droits 600, rangé par `scripts/vegebudget-jeton.js ranger`, jamais affiché) et remplit les indicateurs visites et inscriptions (par jour) et abonnés payants (total du jour) du projet vegebudget. Reprise du cerveau central.

## Relevé Patreon (Impacteur Communauté)

Toutes les 3 heures, Loop Agent lit en lecture seule les membres de la campagne Patreon (API v2) et remplit « Nouveaux membres Patreon » (arrivées actives par jour, 14 derniers jours) , « Revenus Patreon du mois » (total mensuel des membres actifs) et « Membres gratuits Patreon » (créé au premier relevé, décision de Walid du 09/11). Seuls des nombres entrent, aucun nom. Accès (client, secret, clé d'accès, clé de renouvellement) dans `/data/patreon.json` (droits 600), rangés par `ssh -t loop-agent-vps 'docker exec -it loop-agent node scripts/patreon-jeton.js ranger'` (saisie masquée) ; la clé d'accès est renouvelée toute seule avant d'expirer. `essai` affiche seulement des totaux, `retirer` débranche.

## Tri des réponses des restaurants (Nūr Meet)

Le relevé horaire du serveur Nūr envoie aussi toutes les réponses des restaurants (depuis le 05/10, aucune supposée déjà traitée, décision de Walid du 09/11) (n8n np_reponses), coupées avant la citation, adresses et téléphones masqués. Elles attendent dans le document `nour-reponses`. La tâche Claude « Tri des réponses Nūr Meet » (abonnement, 12 h 37 et 18 h 52) les lit avec `reponses_a_trier` et les classe avec `trier_reponses` (même consigne que le cerveau : INTERESSE, QUESTION, REFUS, AUTOMATIQUE, AUTRE). Après le tri, le texte est effacé. Chaque intéressé ou question, même ancien, devient une demande à Walid sur « Lire les réponses reçues » (Telegram), et « Réponses intéressées » est recalculé ; « Réponses reçues des restaurants » vient du relevé.

## Données

Volume Docker `loop-agent_loop_agent_data` : `loop-agent.sqlite` (tout) et `files/` (factures).
Sauvegardes de nuit et copie vers le Mac : étape 3.
