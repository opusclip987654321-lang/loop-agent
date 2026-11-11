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

Le relevé horaire du serveur Nūr envoie aussi toutes les réponses des restaurants (depuis le 05/10, aucune supposée déjà traitée, décision de Walid du 09/11) (n8n np_reponses), coupées avant la citation, adresses et téléphones masqués. Elles attendent dans le document `nour-reponses`. La tâche Claude « Tri des réponses Nūr Meet » (abonnement, 12 h 37 et 18 h 52) les lit avec `reponses_a_trier` et les classe avec `trier_reponses` (même consigne que le cerveau : INTERESSE, QUESTION, REFUS, AUTOMATIQUE, AUTRE). Après le tri, le texte est effacé. Chaque intéressé ou question, même ancien, devient une demande à Walid, sauf s’il lui a déjà répondu : l’automatisation n8n « Nour Meet 5 » (créée par `scripts/n8n-mes-reponses.py`, à lancer sur le serveur Nūr) range dans np_mes_reponses l’adresse, la date, l’objet et le texte écrit par Walid (sans la citation) de chaque mail envoyé depuis contact@nourmeet.com ; la demande se ferme seule quand Walid a répondu, et l’agent Nūr Meet voit la discussion avec chaque restaurant (lire_projet → reponses_restaurants → discussions, mails aux restaurants prospectés seulement, numéros et adresses masqués) sur « Lire les réponses reçues » (Telegram), et « Réponses intéressées » est recalculé ; « Réponses reçues des restaurants » vient du relevé.

## Revue du lundi de la prospection Nūr Meet

Reprise du cerveau central (09/11/2026). Le relevé horaire du serveur Nūr envoie aussi chaque restaurant contacté (nom remplacé par une empreinte), son profil (département, recherche, prix, halal, privatisation), ses mails (jour, version, type) et les envois/échecs par jour (`server/nour-revue.js`). La tâche Claude « Revue du lundi Nūr Meet (Loop Agent) » (abonnement, chaque jour à 9 h 23, ne fait rien s'il n'y a pas de revue due) lit `revue_methode_nour` : méthode, leçons, historique, chiffres par version de mail et par profil, réponses triées. Elle décide seule (consigne identique au cerveau) et écrit avec `ecrire_revue_nour` : changement vérifié puis servi à n8n le lendemain ; changement « radical » (offre, prix, cible, zone) = demande à Walid, appliqué par la revue suivante seulement s'il dit oui. Filet : une nouvelle version qui casse les envois (plus de la moitié en échec, ou plus rien pendant 3 jours) est annulée seule à la réception du relevé. Historique, leçons et revues passées importés du cerveau : `docker exec -i loop-agent node scripts/nour-methode.js importer-revue < loop-nour-meet.json`.

## Archive Notion (import unique du 09/11/2026)

Avant l'arrêt du cerveau central, l'historique tenu dans Notion « Loops des projets » est recopié dans chaque projet : décisions et leçons datées (« 📜 Décisions des loops », 129 lignes), page complète de chaque projet (« 🧠 Mes projets »), règles des loops et revue hebdo du système (projet Gestion), lignes « ✅ Fait pour Walid ». Les agents le lisent dans `lire_projet` → `archive_notion` (`server/archive-notion.js`). Notion n'est ni modifié ni effacé. Export en lecture seule sur le serveur Nūr, import dans Loop Agent : `ssh ubuntu@57.131.152.36 'python3 -' < scripts/notion-export.py | ssh loop-agent-vps 'docker exec -i loop-agent node scripts/import-notion.js'` (relançable).

## Relevé Google Search Console (vegebudget.fr, leviaro.fr)

Accès donné par Walid le 09/11/2026 : le compte de service Google `loop-agent@loop-agent-514221.iam.gserviceaccount.com` (projet Google Cloud « loop agent », API Search Console activée) est utilisateur « Restreint » des sites dans Search Console. Toutes les 6 heures (`server/releve-search-console.js`), Loop Agent lit en lecture seule les clics et affichages Google par jour (30 jours, réécrits car Google a 2 à 3 jours de retard) → indicateurs « Visites venues de Google » ou « Clics depuis Google » et « Affichages dans Google » ; plus les 15 requêtes et 10 pages principales sur 28 jours → `lire_projet` → `search_console`. La demande d'accès Search Console de l'agent se ferme seule. Clé dans `/data/search-console.json` (droits 600), rangée depuis le Mac sans jamais l'afficher ; `node scripts/search-console.js essai | retirer`.

## Étapes des idées (cycle)

Ordre décidé par Walid le 09/11/2026 : Planification → Priorités → Exécution → Vérification → Révision → Mémoire (onglets de la page dans cet ordre ; remarques de page rangées par nom). Les agents oubliaient de faire avancer leurs idées (190 sur 277 en Planification) : Loop Agent les fait avancer seul (`server/stades.js`) — validée par Walid → Priorités, tour de l'agent → Exécution, résultat mesuré → Vérification, réponse de Walid après la vérification → Révision, leçon notée → Mémoire ; jamais à reculons, l'agent peut toujours choisir un stade. Chaque carte d'action montre où en sont ses idées. Une idée finie (faite, ou remplacée par autre chose, preuve obligatoire) quitte l'action et va dans la Mémoire ; une action dont toutes les idées sont finies se termine seule (une boucle devenue inutile : `terminee` + `raison_fin`) et quitte Planification, Priorités, Exécution et Vérification (décision de Walid du 09/11 : il n'a pas le temps de passer derrière). Garde-fou : `lire_projet` → `a_faire_d_abord` liste une idée jugée depuis 3 jours sans leçon, ou un résultat mesuré sans compte rendu ; l'agent le rattrape avant son travail du jour (règle 16 du connecteur).

## Onglet Documents

Demande de Walid du 11/11/2026 : dans chaque projet, l'onglet « Documents » est le registre de tous les documents lus par le projet (relevés bancaires, charges, factures, impôts, prêt, bail…) et de ce qu'il en a retenu, pour savoir ce qui est déjà pris en compte (`public/documents.js`, champ `documents` du document du projet). Ces documents sont sensibles : **aucun fichier n'est envoyé à Loop Agent** (décision de Walid du 11/11/2026), seulement le nom, le type, la période, l'endroit où il se trouve et ce qui a été retenu (sans IBAN). L'agent note chaque document lu avec `enregistrer_document` ; Walid peut en signaler un (« à lire »), que l'agent lit là où il est. `lire_projet` → `documents` donne le registre pour qu'aucun document ne soit compté deux fois. Les factures de la page Argent rapprochées d'une dépense du projet s'affichent en dessous.

## Onglet Frais évitables

Demande de Walid du 11/11/2026 : dans chaque projet, l'onglet « Frais évitables » liste ce qu'il paie alors qu'il ne devrait pas (agios, frais d'incident ou commissions d'intervention, rejets de prélèvement ou de virement, frais de saisie, pénalités d'impôts, frais d'avocat ou de commissaire de justice, frais de recouvrement du syndic…), avec les totaux payé / perdu pour de bon / à venir / récupéré et, pour chaque frais, la piste pour ne plus le payer ou le récupérer (`public/frais.js`, champ `frais` du document du projet). L'agent note chaque frais lu sur un relevé ou un avis avec `enregistrer_frais_evitable` (montant lu et source ; un montant calculé ou annoncé est marqué estimation ; jamais d'IBAN) ; `lire_projet` → `frais_evitables` donne la liste et les totaux pour ne rien compter deux fois. Walid peut ajouter un frais, changer son état (contesté, remboursé), noter ce qui a été récupéré ou le retirer. Les montants vivent dans la base, jamais dans le dépôt.

## Données

Volume Docker `loop-agent_loop_agent_data` : `loop-agent.sqlite` (tout) et `files/` (factures).
Sauvegardes de nuit et copie vers le Mac : étape 3.
