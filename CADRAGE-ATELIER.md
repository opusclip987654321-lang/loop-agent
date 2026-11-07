# Atelier des agents — cadrage

Document de référence pour la mise en production.
Rédigé le 06/11/2026 à partir des décisions prises avec Walid.
Le site s'appelle désormais **Loop Agent** (décision du 06/11/2026). **[Décidé]**
Statuts utilisés : **[Décidé]** (choix de Walid), **[Proposé]** (suggestion non validée), **[À confirmer]** (point ouvert).

---

## 1. À quoi sert ce site

Un visuel des boucles de chacun des projets de Walid, pour voir ce qui se passe réellement : ce que chaque agent fait, ce qu'il mesure, ce qu'il apprend, et ce qui attend une décision. **[Décidé]**

Ce n'est **pas** un outil de supervision technique : les erreurs serveur, la surveillance des conteneurs et les pannes n'y figurent pas. **[Décidé]**

L'Atelier est **indépendant** : aucun lien, aucune dépendance et aucun échange de données avec un autre outil de pilotage existant. **[Décidé]**

---

## 2. Les projets

Huit projets, chacun avec son espace isolé (tâches, idées, notes, priorités, mémoire). **[Décidé]**

| Projet | Type |
|---|---|
| Email interview Impacteur | Automatisation (5 workflows n8n) |
| Impacteur Sponsors | Espace admin + loop quotidienne |
| L'Extrait politique | Chaîne YouTube automatisée — **en pause depuis le 19/10/2026** |
| Agent Cambodge emploi | Agent (tâche programmée) |
| VégéBudget | Site web avec abonnement mensuel |
| Leviaro | Site web de prospection commerciale |
| Petites Histoires Vraies | Chaîne YouTube format stickman |
| Nūr Meet | Site et application de rencontres |

**Règle d'entrée** : seuls les projets qui ont une boucle entrent dans l'Atelier. Les outils et les projets non définis en sont exclus. **[Décidé]**
Trois projets ont été retirés à ce titre : Agent de montage vidéos, Cerveau central, Trader question actu. **[Décidé]**

---

## 3. Structure : six étapes, pas un tunnel

Le cycle comporte six étapes : Planification, Exécution, Vérification, Mémoire, Priorités, Révision. **[Décidé]**

**Point structurel essentiel** : une action **n'avance pas** d'une page à l'autre. Les six étapes sont **six regards sur les mêmes actions**. Une boucle est vivante en permanence : elle est planifiée, exécutée, mesurée, elle apprend, et elle recommence. **[Décidé]**

Ce qui avance, ce sont les **idées** à l'intérieur d'une action : chacune porte son dernier stade atteint, et peut revenir en arrière (de Révision vers Exécution, par exemple). **[Décidé]**

Une page **Argent** existe hors du cycle, sous les six étapes, sans numéro. **[Décidé]**

---

## 4. Deux natures d'action

| Type | Comportement |
|---|---|
| **Boucle** | Permanente. Ne se termine jamais. Visible sur les six étapes en continu. |
| **Ponctuelle** | Naît, se fait, se termine. Quitte Planification, Exécution et Priorités une fois terminée ; reste en Vérification, Mémoire et Révision. |

Le type est visible sur la carte de l'action. **[Décidé]**

C'est la règle qui évite que la liste gonfle : seules les ponctuelles s'accumulent, et seules elles sortent. **[Décidé]**

### Cas de Petites Histoires Vraies
- Une **vidéo longue** = une action ponctuelle, avec ses étapes (texte, dessins, montage, date de diffusion). **[Décidé]**
- Un **Short** = une idée à l'intérieur de l'action de la vidéo dont il découle. **[Décidé]**
- Ouvrir une vidéo montre : son texte, ses dessins, son montage, sa date de diffusion, et les Shorts qui en découlent. **[Décidé]**
- La **surveillance des chiffres est une action à part**, permanente, qui compare les vidéos entre elles et crée des actions selon ses constats. Les chiffres d'une vidéo ne lui appartiennent pas. **[Décidé]**
- Les actions « métier » actuelles (sélectionner, écrire, produire) sont à revoir : elles deviennent les étapes internes de chaque vidéo. **[À confirmer]**

---

## 5. Autonomie des agents

**Principe** : l'agent est autonome. La validation de Walid n'est pas un passage obligé, elle intervient à trois moments précis. **[Décidé]**

1. **La première fois** qu'une action tourne : l'agent propose, Walid valide. Ensuite, l'action est autonome.
2. **Quand l'agent crée une nouvelle action** : elle attend la validation avant de partir.
3. **Quand l'agent propose une modification** après avoir étudié des statistiques, des mails ou une veille.

L'état d'autonomie est **visible sur chaque action** : « Première fois à valider » ou « Autonome ». **[Décidé]**

### Modification d'une action en cours

Quand l'agent modifie une action déjà autonome, **elle retombe en « à valider »**. L'autonomie se perd dès que l'action change de forme, et se regagne à la validation. **[Décidé]**

**Pendant l'attente, l'action s'arrête par défaut.** Elle ne continue que si l'agent est **certain** qu'il n'y aura ni effet négatif, ni temps perdu, ni incohérence avec la modification une fois validée. La certitude est la condition, pas le doute. **[Décidé]**

*(Note : une alternative avait été proposée — distinguer « incertain » de « nuisible » et laisser tourner en cas de simple doute. Walid l'a écartée.)*

L'action arrêtée reste visible, avec un bandeau expliquant pourquoi et deux boutons : valider la modification, ou refuser et reprendre l'ancienne version. **[Décidé]**

### Relance de l'agent après une décision

Quand Walid valide, refuse ou répond (proposition, modification, premier résultat, idée, indicateur, action ajoutée, reprise après pause), Loop Agent **relance la routine Claude du projet** par son déclencheur « API », avec la liste des décisions. **Au plus une fois toutes les 30 minutes par projet** ; une décision prise pendant ce délai part à la fin du délai. Seuls les projets dont l'agent tourne en routine, et dont le jeton a été rangé sur le serveur, sont relancés. Le tour consomme l'abonnement Claude, pas l'API. Un message Telegram signale chaque relance, ou l'échec d'une relance. **[Décidé le 7 nov. 2026]**

---

## 6. Les couleurs

Trois couleurs, pas quatre. Pas d'orange. **[Décidé]**

| Couleur | Sens |
|---|---|
| **Vert** | Rien à faire, ça tourne |
| **Rouge** | Quelque chose attend Walid : il faut cliquer dedans |
| **Gris** | En pause (une pause n'est pas une panne) |

**La couleur remonte** : idée rouge → action rouge → projet rouge dans le sélecteur. **[Décidé]**

Quand on ouvre une action rouge, un bandeau en haut nomme les idées qui attendent, et **ces idées sont placées en premier** dans la liste. Sans cela, on tombe sur une idée verte et il faut chercher. **[Décidé — correction d'un défaut constaté]**

Ce mécanisme remplace toute page d'erreurs séparée : une erreur est un **état de l'idée concernée**, pas une page à part. **[Décidé]**

---

## 7. Les boucles permanentes de chaque projet

Trois boucles minimum, dans tous les projets : **[Décidé]**

1. **Lire les réponses reçues** — ce que les gens répondent vraiment.
2. **Surveiller les statistiques** — ce que les chiffres disent du travail fait.
3. **Veille extérieure** — ce qui se passe ailleurs et mérite d'être essayé.

Ces trois boucles observent, apprennent, et **créent des actions**. La chaîne complète : surveillance → constat → nouvelle action proposée → validation de Walid → l'action tourne seule. **[Décidé]**

Les erreurs, les pannes et les dépenses par projet ne font **pas** partie de ces boucles. **[Décidé]**

---

## 8. Lecture des mails

**Tous les projets lisent des mails**, y compris ceux qui n'en envoient pas : un agent autonome a besoin de données extérieures. **[Décidé]**

- Les agents ont accès à **toutes les boîtes** de Walid et trient ce qui les concerne. **[Décidé]**
- **Un mail ne commande jamais rien.** Il peut déclencher une **proposition d'action**, que Walid valide. C'est la protection contre une instruction glissée dans un message. **[Décidé]**
- Conséquence à surveiller : les mails personnels (banque, santé, administratif) deviennent lisibles et peuvent finir en mémoire. Exclusion de certains libellés à prévoir. **[Proposé]**

**Jamais de mot de passe, de clé ni de jeton en clair**, ni dans le code, ni dans la documentation, ni dans une conversation. **[Décidé]**

---

## 9. Forme d'une proposition de l'agent

Une proposition n'est pas une case à cocher : c'est une note de bras droit, en cinq points. **[Décidé]**

1. **Ce que j'ai observé** — le fait et sa source (quel mail, quelle statistique, sur quelle période, quel volume).
2. **Ce que j'en déduis** — présenté comme une hypothèse tant que ce n'est pas vérifié.
3. **Ce que je propose** — en termes opérationnels : quoi, sur quelle action, à partir de quand.
4. **Ce que ça change** — l'effet attendu, le temps que ça prend, ce que ça coûte.
5. **Si on ne fait rien** — ce qui se passe, et quand ça devient un problème.

Le cinquième point est celui qui manque presque toujours : sans lui, tout semble urgent ou rien ne l'est.

L'échange se fait dans l'**espace de commentaire de l'idée concernée**, qui existe déjà. Pas de zone de discussion supplémentaire. **[Décidé]**

---

## 10. La mémoire

**La mémoire est l'entrée de la planification suivante.** C'est ce qui ferme la boucle : sans cela, l'agent enregistre son expérience mais ne la réinjecte nulle part, et ce qui s'appelle une boucle n'en est pas une. **[Décidé]**

- Ce que l'agent a retenu **reste dans Mémoire**. **[Décidé]**
- Dans Planification, l'action arrive **déjà travaillée grâce à l'apprentissage**, sans bloc explicatif. **[Décidé]**
- *Conséquence signalée* : si l'agent tire une mauvaise leçon, elle ne se voit pas dans Planification ; il faut ouvrir la Mémoire pour la repérer.
- Chaque leçon porte un statut : **à tester / confirmée / invalidée**. **[Décidé]**
- Quand l'agent change de méthode suite à une leçon, c'est **signalé dans Révision**. **[Décidé]**

La mémoire doit contenir les **statistiques cumulées**, pas seulement des leçons écrites : taux d'ouverture par type de message, par secteur, par pays, selon le projet. C'est la matière première du tour suivant. **[Décidé]**

### Mémoire des actions terminées
Problème identifié : la Mémoire est organisée **par action**. Si une action ponctuelle terminée sort de la liste, sa mémoire sort avec elle — on perdrait les statistiques des vidéos passées.

**Tranché le 06/11/2026** : la mémoire est rangée **par projet** ; chaque leçon et chaque chiffre indique l'action qui l'a produit. Elle est stockée dans Loop Agent (pas dans Notion), et les agents l'écrivent dans le même envoi que leur tour. **[Décidé]**

---

## 11. Page Argent

Reprise intégrale de la page Argent existante, dans l'ordre suivant : **[Décidé]**

1. **Quatre tuiles** : Ce mois-ci (abonnements + recharges du mois) · Fixe par mois (abonnements et domaines lissés) · Recharges 30 derniers jours · Factures (X / Y à jour).
2. **Factures** : zone de dépôt (PDF, PNG, JPG, WebP, 10 Mo max), liste avec états (lue, lecture en cours, pas une facture, doublon « compté une seule fois »), boutons ↻ Relire et ✕ Supprimer, « Voir N facture(s) de plus ». Bloc « ✏️ Corrigé d'après tes factures » avec bouton Annuler par correction.
3. **Ce que l'IA coûte ce mois-ci** : Usage · Ce mois · Plafond.
4. **Dépenses** : Dépense (nom + projet) · Montant (+ fréquence) · Quand · Facture · actions. Regroupement des dépenses de même nom avec ▸. Tri mensuels, puis annuels, puis « une fois ».
5. **Historique** : Mois · Abonnements · Recharges · Total, **chaque cellule détaillant dépense par dépense**. Totaux par année et depuis le début.
6. **Par projet** : tableau croisé mois × projet, chaque cellule détaillée avec son sous-total, ligne Total en bas.

**Règles de calcul** :
- Abonnements annuels lissés sur 12 mois.
- Abonnements comptés chaque mois à partir de leur mois d'entrée.
- Recharges comptées à leur date.
- **Aucune conversion € / $** : les totaux s'affichent « 144,07 € + 24 $ ».
- Facture « à jour » : mensuel = moins de 35 jours ; annuel = moins de 366 jours ; une fois = une facture existe.

**La page Argent est globale**, tous projets confondus, et non limitée au projet actif. **[Décidé]**

**Trois ajouts par rapport à l'existant** : un filtre par projet, une recherche par nom, et un bouton Modifier (aujourd'hui il faut supprimer et recréer). **[Proposé — à valider par Walid]**

---

## 12. Comment les données réelles arrivent

**Point structurel** : la plupart des données ont une source extérieure qu'on peut lire (YouTube donne les vues, Gmail donne les réponses). Mais **l'activité de la boucle elle-même n'existe nulle part ailleurs que dans le fil Claude de l'agent**. Personne ne peut aller la chercher.

« L'agent a publié cette vidéo, voici pourquoi, voici ce qu'il en a retenu » : si l'agent ne l'écrit pas, ça n'existe pas.

L'Atelier ne peut donc pas se contenter de lire des sources : **chaque agent doit y écrire ce qu'il fait, à chaque tour**. **[À confirmer : mécanisme et contenu exact]**

---

## 13. État de la maquette

Le fichier `atelier-maquette.html` est une page autonome fonctionnant dans le navigateur, données en stockage local.

**Fonctionne réellement** : navigation à six étapes, sélection de projet avec données isolées, couleurs et remontée, autonomie par action, arrêt sur modification avec validation ou refus, propositions en cinq points, statuts de leçons, filtres, page Argent complète (ajouter, modifier, retirer, filtrer, rechercher, supprimer une facture, annuler une correction).

**Simulé** : dépôt et lecture automatique de factures, alertes Telegram, connexions aux outils, tous les chiffres.

**Scénarios concrets intégrés** : Impacteur Sponsors (jour d'envoi, relance des 94 marques, Gmail non connecté), Email interview Impacteur (plafond 5 au lieu de 8, 61 % de fiches sans adresse), Agent Cambodge (11 des 15 offres validées étaient en télétravail).

---

## 14. Points ouverts

1. ~~Mémoire des actions ponctuelles terminées~~ — tranché : par projet (voir §10).
2. Petites Histoires Vraies : que deviennent les actions « métier » si chaque vidéo est une action ?
3. Les propositions de l'agent : mélangées aux idées validées, ou dans leur propre bloc en haut ?
4. Mécanisme exact par lequel les agents écrivent dans l'Atelier.
5. Exclusion de certains libellés de mails personnels.
6. Les trois ajouts de la page Argent (filtre, recherche, Modifier) sont-ils conservés ?
7. L'Extrait politique est en standby : ses règles particulières (deux chaînes, débit continu, coût résiduel en pause) n'ont pas été traitées.

---

## 15. Contraintes de réalisation

- **Jamais de secret en clair** : clés, mots de passe et jetons se posent sur le serveur, jamais dans le code, la documentation ou une conversation.
- **Rien d'irréversible, de public ou de payant sans l'accord de Walid** : envoi, publication, paiement, suppression, abonnement, dépassement de budget.
- Après chaque changement, vérifier que tout fonctionne encore ; si quelque chose casse, annuler et noter la leçon.
- Toujours dire ce qui a été modifié.
