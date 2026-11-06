# Arbitrages

Ce document rassemble les choix de conception du projet. Pour chacun : la solution retenue, l'alternative écartée, la raison du choix, et ce qu'il coûte. Le cahier demande de « justifier ses choix plutôt que de multiplier les composants » : la plupart des arbitrages vont donc vers la solution la plus simple qui garantit la règle.

Le détail des règles et des hypothèses est dans [etats-transitions.md](etats-transitions.md) (R1 à R14, H1 à H23). Le détail des tables est dans [modele-donnees.md](modele-donnees.md), et celui des outils dans [stack-technique.md](stack-technique.md).

---

## 1. Données et cohérence

### 1.1 SQL brut plutôt qu'un ORM

- **Retenu :** le pilote `pg`, des requêtes SQL paramétrées, une interface TypeScript par table.
- **Écarté :** Prisma, TypeORM, ou un générateur de requêtes comme Knex.
- **Pourquoi :** les garanties critiques reposent sur PostgreSQL lui-même : index uniques partiels, `UPDATE ... WHERE` conditionnels, séquence, transactions. Écrites en SQL, elles se lisent comme elles s'exécutent.
- **Contrepartie :** la conversion des lignes se fait à la main, et chaque requête doit être paramétrée. C'est une règle du projet, qu'aucun outil ne vérifie à notre place.

### 1.2 La base garantit les règles de concurrence

- **Retenu :** la base est la dernière barrière.
  - R6 est porté par l'index unique partiel `uq_demande_en_cours` ;
  - une seule décision par version, par `UNIQUE (request_id, request_version)` ;
  - R7 et R11 sont portés par des mises à jour conditionnelles.
- **Écarté :** une vérification dans le code (« existe-t-il déjà une demande en cours ? ») suivie d'une insertion.
- **Pourquoi :** une vérification suivie d'une écriture laisse une fenêtre. Deux requêtes simultanées passent toutes les deux la vérification. L'index, lui, refuse la seconde quoi qu'il arrive.
- **Contrepartie :** il faut traduire l'erreur PostgreSQL `23505` en réponse 409 avec le bon code de règle.

### 1.3 Concurrence optimiste (version) plutôt que verrouillage

- **Retenu :** chaque action utilisateur porte la version lue. La mise à jour est `UPDATE ... WHERE id = $1 AND version = $2 AND statut = $3`. Si aucune ligne n'est modifiée, la réponse est 409, et l'écran recharge le dossier.
- **Écarté :** `SELECT ... FOR UPDATE` au moment de l'affichage, ou un verrou applicatif « dossier ouvert par… ».
- **Pourquoi :** le cahier décrit exactement ce cas : « une décision fondée sur une version périmée doit être rejetée ». Un verrou tenu pendant qu'un humain lit l'écran bloquerait les autres sans raison.
- **Contrepartie :** le second acteur doit relire et refaire son action. C'est le comportement voulu.

### 1.4 Version technique et révision métier séparées

- **Retenu :** deux numéros (H14).
  - `version` est un compteur technique, incrémenté à chaque changement et jamais affiché.
  - `revision_no` est la version métier (v1, v2…), créée à chaque soumission.
- **Écarté :** un seul numéro pour les deux.
- **Pourquoi :** le brouillon change souvent, et chaque changement doit invalider une confirmation ancienne. Mais le client ne doit voir que les versions qu'il a soumises.
- **Contrepartie :** il y a deux notions à expliquer. Les formulaires transmettent la version sans l'afficher.

### 1.5 Le brouillon peut enfreindre les règles

- **Retenu :** aucun `CHECK` métier sur `requests`. `verifierRegles` renvoie la liste complète des erreurs :
  - au brouillon, ce sont des avertissements qui ne bloquent rien (H23) ;
  - à la soumission, c'est un refus 422.
- **Écarté :** refuser d'enregistrer un brouillon incomplet.
- **Pourquoi :** le client, ou l'agent, prépare la demande par étapes. Le cahier demande qu'une soumission incomplète soit refusée, pas qu'un brouillon le soit. Une seule fonction sert aux deux usages, donc les règles ne peuvent pas diverger.
- **Contrepartie :** la base n'empêche pas un brouillon invalide ; c'est le service qui empêche sa soumission.

### 1.6 La référence est tirée à la première soumission

- **Retenu :** une séquence PostgreSQL, lue dans la transaction de la première soumission (H13). Le format est `DEM-2026-000123`.
- **Écarté :** une référence dès la création du brouillon.
- **Pourquoi :** le cahier dit que c'est la demande **soumise** qui reçoit une référence. Un brouillon abandonné ne consomme rien.
- **Contrepartie :** une séquence n'est pas annulée avec la transaction. Une soumission refusée peut laisser un trou dans la numérotation, sans conséquence sur l'unicité.

---

## 2. Processus et activation

### 2.1 L'appel bancaire après la validation, pas dans la transaction

- **Retenu :** l'approbation passe la demande à `APPROUVEE`, avec l'activation `EN_ATTENTE`, dans une transaction. La banque est appelée **après** le `COMMIT`. Le résultat est ensuite enregistré par une mise à jour conditionnée au statut `APPROUVEE`.
- **Écarté :** appeler la banque à l'intérieur de la transaction.
- **Pourquoi :** une transaction ne peut pas annuler un appel externe. Si la banque applique le plafond et que la transaction échoue ensuite, la base dirait « pas activé » alors que le plafond est actif. En validant d'abord, l'état est toujours vrai : « approuvée, activation en attente ».
- **Contrepartie :** une demande peut rester `APPROUVEE` avec une activation en échec ou inconnue. C'est exactement ce que le cahier demande d'afficher, et le bouton « Relancer » permet d'en sortir.

### 2.2 Une clé d'idempotence fixe plutôt qu'une table de clés HTTP

- **Retenu :** chaque opération bancaire a une clé déterminée par le dossier : `act-<id>` ou `desact-<id>`. La banque simulée enregistre le résultat de chaque clé et renvoie ce résultat à toute répétition (H16).
- **Écarté :** une table générique de clés d'idempotence pour les requêtes HTTP.
- **Pourquoi :**
  - une demande ne s'active qu'une fois, donc la clé n'a pas besoin d'être tirée au hasard ;
  - la répétition de la même opération est absorbée par la banque elle-même ;
  - c'est ce qui permet de retrouver le résultat après une réponse perdue sans réappliquer l'opération ;
  - les autres répétitions (double clic, relance réseau) sont déjà couvertes par la version et par l'index R6.
- **Contrepartie :** le mécanisme est propre à cette opération, et non générique.

### 2.3 Reprise par un bouton plutôt que par un worker

- **Retenu :** un bouton « Relancer », réservé au conseiller ou au superviseur du dossier. Il rejoue l'activation avec la même clé (H12, H15).
- **Écarté :** un worker qui reprend automatiquement les activations en échec.
- **Pourquoi :** le cahier exige qu'une reprise soit *possible* sans double activation. Un worker ajouterait un processus, une politique de tentatives et des cas de concurrence, sans rien apporter aux scénarios.
- **Contrepartie :** une activation qui échoue à chaque reprise laisse la demande bloquée en `APPROUVEE`. C'est une limite connue, à résoudre hors de l'application.

### 2.4 Expiration par une commande plutôt que par une tâche planifiée

- **Retenu :** `npm run expire -- --date <date>`. La commande reçoit deux dates (H22) :
  - la date simulée, qui sélectionne les échéances ;
  - l'heure réelle, qui date les événements.
- **Écarté :** un cron, ou une tâche planifiée dans l'API.
- **Pourquoi :** le cahier autorise une « commande de démonstration reproductible ». On peut montrer l'expiration en quelques secondes, sans attendre trois jours.
- **Contrepartie :** en production, il faudrait la lancer périodiquement. Une date antérieure à l'heure réelle est refusée, pour que l'historique reste chronologique.

### 2.5 « Expirée » seulement après la désactivation confirmée

- **Retenu :** la demande passe à `EXPIREE` quand la banque confirme le retour au plafond initial (H6). Une désactivation échouée est reprise au passage suivant de la commande.
- **Écarté :** passer à `EXPIREE` dès l'échéance.
- **Pourquoi :** l'état affiché doit refléter l'exécution. Tant que la banque applique le plafond temporaire, il est actif.
- **Contrepartie :** une demande peut rester `ACTIVE` après son échéance, le temps d'une reprise.

### 2.6 Le rôle est déduit de l'état, jamais choisi par l'utilisateur

- **Retenu :** pour un utilisateur qui a les deux rôles, le serveur déduit le rôle de l'action et du statut (H18). Une décision sur une demande soumise est prise comme conseiller ; une décision sur une demande transmise, comme superviseur. R9 est vérifiée sur `recommender_id`.
- **Écarté :** un sélecteur de rôle dans l'interface, ou un rôle envoyé dans la requête.
- **Pourquoi :** un rôle choisi par le client serait un moyen de contourner R8 et R9.
- **Contrepartie :** un changement de rôle ne prend effet qu'à la connexion suivante, car la session garde une copie de l'utilisateur.

### 2.7 Interprétations prudentes des ambiguïtés

- **Au-delà de 30 000 DH, le conseiller ne peut pas rejeter seul (H2).** Le cahier impose la décision du superviseur sans distinguer approbation et rejet.
- **Le client peut annuler une demande en attente du superviseur (H3).** Une recommandation n'est ni une approbation ni un rejet.
- **Le superviseur ne demande pas de complément (H5).** Le cahier limite son rôle à approuver ou rejeter.

---

## 3. Sécurité

### 3.1 404 plutôt que 403 pour un dossier hors périmètre

- **Retenu :** le périmètre est dans la requête SQL. Un dossier hors périmètre et un dossier inexistant reçoivent la même réponse 404. Le dossier est chargé avec ce filtre **avant** toute mise à jour.
- **Écarté :** charger le dossier, puis répondre 403 s'il n'appartient pas à l'utilisateur.
- **Pourquoi :** un 403, ou un 409 sur un dossier qu'on ne devrait pas voir, confirmerait son existence.
- **Contrepartie :** le message est moins explicite pour un utilisateur légitime qui se trompe d'identifiant.

### 3.2 Refus tracés après l'annulation, à un seul endroit

- **Retenu :** `tracerLesRefus` entoure tout ce qui peut refuser l'action : le chargement avec le filtre, les règles et la mise à jour. Le refus est écrit dans `events` **après** l'annulation de la transaction, par une écriture séparée.
- **Écarté :** écrire le refus dans la transaction, ou dans chaque controller.
- **Pourquoi :** écrit dans la transaction, le refus serait annulé avec elle. Dispersé dans les controllers, il serait oublié quelque part.
- **Contrepartie :** l'identifiant visé va dans `details`, et non dans `request_id`, pour ne pas rattacher la tentative à l'historique d'un autre client.

### 3.3 Sessions serveur plutôt que des jetons JWT

- **Retenu :**
  - `express-session`, avec un stockage dans PostgreSQL ;
  - un cookie `httpOnly` et `SameSite=Strict` ;
  - une session régénérée à la connexion et expirée après 30 minutes d'inactivité.
- **Écarté :** un JWT stocké dans le navigateur.
- **Pourquoi :**
  - le cahier dit que « les identités et autorisations viennent de la session serveur » ;
  - une session se détruit côté serveur à la déconnexion ;
  - `SameSite=Strict`, avec l'API et le frontend sur la même origine, protège contre le CSRF.
- **Contrepartie :** la session est une copie prise à la connexion. Le statut du dossier client (R5) est donc toujours relu en base, jamais dans la session.

---

## 4. Intelligence artificielle

### 4.1 Le modèle propose, le serveur décide

- **Retenu :** quatre outils seulement : `consulter_comptes`, `consulter_dossier`, `preparer_brouillon` et `proposer_soumission`. Ils appellent les mêmes services que les formulaires, avec l'identité de la session.
- **Écarté :**
  - un outil `soumettre`, qui irait plus vite ;
  - des outils qui écriraient directement en base.
- **Pourquoi :** le cahier dit qu'« une conversation seule ne vaut pas confirmation ». L'agent n'a ainsi aucun pouvoir de plus qu'un formulaire. La soumission passe par le clic du client sur la carte de confirmation, qui appelle la même route que le formulaire.
- **Contrepartie :** il faut un clic de plus pour soumettre depuis le chat. C'est voulu.

### 4.2 La carte transmet ce que le client a vu, sans jeton stocké

- **Retenu :** la carte affiche le montant, la durée et le motif lus en base, et transmet la version sans l'afficher. La soumission n'est acceptée que si la version, le montant et la durée sont toujours les mêmes (R7).
- **Écarté :** un jeton de confirmation enregistré en base, avec une durée de validité.
- **Pourquoi :** toute modification incrémente la version. Une carte ancienne échoue donc d'elle-même, sans table ni nettoyage. Le contrôle est la même mise à jour conditionnelle que pour le reste.
- **Contrepartie :** la confirmation n'a pas de date d'expiration propre. La version suffit à empêcher qu'elle valide autre chose.

### 4.3 Les avertissements viennent du serveur, pas du modèle

- **Retenu :** `preparer_brouillon` renvoie les avertissements de `verifierRegles`, avec leur code. L'interface les affiche comme des **données du système**. Le texte du modèle est affiché à part, comme une **explication**.
- **Écarté :** laisser le modèle juger seul si la demande est complète.
- **Pourquoi :** le modèle peut se tromper ou être manipulé. Les règles, elles, sont du code testé.
- **Contrepartie :** le texte du modèle peut rester faux. Il est affiché comme du texte simple, sans HTML, et rien ne dépend de lui.

### 4.4 Groq appelé par `fetch`, derrière une interface

- **Retenu :** l'interface `LlmClient`, avec trois implémentations :
  - le mode simulé, déterministe, utilisé par défaut partout ;
  - le mode connecté avec Groq, appelé par `fetch` sans SDK ;
  - le modèle piégé, réservé aux tests.
- **Écarté :** un SDK de fournisseur, ou un framework d'agents.
- **Pourquoi :**
  - l'offre gratuite de Groq permet de tester sans coût ;
  - son API au format OpenAI tient en un appel HTTP ;
  - l'interface permet de changer de fournisseur sans toucher à l'agent ;
  - le mode simulé permet à l'évaluateur de tout lancer sans clé.
- **Contrepartie :** les limites de débit de l'offre gratuite peuvent rendre le chat indisponible quelques instants. Les formulaires restent utilisables.

### 4.5 Des tests d'attaque avec un modèle qui obéit à l'attaquant

- **Retenu :** un modèle piégé, dans `api/test/`, appelle les outils avec des arguments malveillants :
  - un outil inexistant ;
  - le compte d'un autre client ;
  - une version inventée ;
  - un champ `statut` ajouté ;
  - plus de 3 appels dans un même message.

  Chaque test vérifie trois choses : aucune table métier modifiée, aucune donnée hors périmètre renvoyée, et un refus tracé.
- **Écarté :** tester seulement que le vrai modèle refuse poliment.
- **Pourquoi :** la sécurité ne doit pas dépendre de la bonne conduite du modèle. Le pire cas, un modèle entièrement manipulé, est testé dans la CI, de façon déterministe.
- **Contrepartie :** ces tests ne mesurent pas la qualité des réponses du vrai modèle.

### 4.6 Des garde-fous chiffrés

- **Retenu :**
  - 15 s par appel au modèle ;
  - 3 appels d'outils par message, donc 4 appels au modèle au plus ;
  - 1 024 tokens de réponse ;
  - 10 échanges gardés en mémoire.

  Le justificatif n'est jamais transmis au modèle.
- **Pourquoi :** ces chiffres bornent le coût et le temps d'attente, et limitent l'effet d'une boucle provoquée par un message malveillant.

---

## 5. Organisation du code

- **Un domaine pur.** Les règles et la table des transitions sont dans `api/src/domain`, sans NestJS ni `pg`. Elles sont testées avec les bornes (10 000 / 10 001 DH, 0 / 1 / 7 / 8 jours…).
- **Un seul chemin vers les règles.** Les routes, les outils de l'agent et la commande d'expiration appellent les mêmes services. Aucune règle n'est écrite dans un controller ni dans un outil.
- **Pas de monorepo ni de package partagé.** Les quelques types utiles au frontend sont recopiés dans `web/src/types.ts`.
- **Pas de bibliothèque de composants.** L'interface est faite de quelques composants React et d'une feuille de style.
- **Tests sur une vraie base.** Les tests d'API utilisent PostgreSQL, jamais un mock. C'est la seule façon de vérifier les index et les mises à jour conditionnelles.

---

## 6. Ce qui a été laissé de côté, volontairement

| Élément | Raison |
|---|---|
| Worker de reprise automatique | La reprise est possible par le bouton « Relancer », avec la même clé (2.3). |
| Tâche planifiée | Une commande reproductible est autorisée et plus simple à montrer (2.4). |
| Table de clés d'idempotence HTTP | La version, l'index R6 et la clé bancaire fixe couvrent déjà les répétitions (2.2). |
| Jeton de confirmation stocké | La version suffit (4.2). |
| Triggers, clés étrangères composites | Les règles sont lisibles dans le code et dans quelques contraintes simples. |
| Swagger, limitation de débit, journaux structurés | Utiles en production, sans effet sur les scénarios. |
| Réaffectation d'un dossier | Hors du parcours demandé (H9). |
| Sortie d'une demande bloquée en `APPROUVEE` | Cas rare, résolu hors de l'application (2.3). |

Les limites connues sont détaillées dans [etats-transitions.md](etats-transitions.md), § 8.
