# Questions probables de l'évaluateur

Préparation à l'oral. Pour chaque question : une réponse courte, à dire avec ses propres mots, et le fichier à ouvrir pour la montrer. Les liens sont relatifs au dossier `docs/`.

Conseil général : répondre d'abord par le mécanisme (« c'est la base qui le garantit, par… »), puis montrer le code ou le test. Un test qui passe convainc plus qu'une explication.

---

## 1. Processus métier

**Q1. Montrez-moi le cycle de vie d'une demande.**
Dix statuts métier, et un statut d'activation à part. Les transitions autorisées sont dans une table, en TypeScript pur, et chaque transition est testée. L'état métier, la décision et le résultat d'exécution sont séparés :
- l'état est dans `requests.statut` ;
- les décisions sont dans la table `decisions` ;
- le résultat bancaire est dans `activation_statut`.

À montrer : le diagramme dans [etats-transitions.md](etats-transitions.md), puis [transitions.ts](../api/src/domain/transitions.ts#L47).

**Q2. Quelle différence entre « approuvée » et « active » ?**
« Approuvée » est une décision humaine. « Active » veut dire que la banque a confirmé l'application du plafond. Entre les deux, l'activation est en attente, en échec ou au résultat inconnu, et le client le voit.
À montrer : l'écran de détail côté client, et la frise.

**Q3. Pourquoi le conseiller ne peut-il pas rejeter seul au-delà de 30 000 DH ?**
C'est l'hypothèse H2. Le cahier impose une « décision obligatoire du superviseur » au-delà de ce seuil, sans distinguer l'approbation du rejet. J'ai pris l'interprétation la plus prudente : le conseiller recommande, favorablement ou non, et le superviseur décide.
À montrer : [regles.ts](../api/src/domain/regles.ts#L134), la fonction `verifierDecision`.

**Q4. Un utilisateur conseiller et superviseur peut-il valider sa propre recommandation ?**
Non, c'est la règle R9. Le serveur enregistre `recommender_id` au moment de la recommandation, et refuse la décision du superviseur si c'est la même personne. Le rôle n'est jamais choisi par l'utilisateur : il est déduit de l'état du dossier (H18).
À montrer : [regles.ts:158](../api/src/domain/regles.ts#L158) et [dossiers.service.ts:222](../api/src/demandes/dossiers.service.ts#L222).

**Q5. Le client peut-il modifier une demande déjà soumise ?**
Non, seulement par le cycle de complément, à l'initiative du conseiller (H7). Toute modification est refusée tant que la demande est en examen, car la table des transitions l'interdit depuis ces statuts. Chaque nouvelle soumission crée une révision (v1, v2…) ; les anciennes restent consultables.

**Q6. Jusqu'à quand le client peut-il annuler ?**
Jusqu'à la première décision d'approbation ou de rejet, donc aussi en attente du superviseur : une recommandation n'est pas une décision (H3). Après une approbation, l'annulation est refusée avec un 409 (R12).

**Q7. Comment se calcule l'échéance ?**
L'échéance vaut la date d'activation plus la durée multipliée par 24 heures, en UTC (H8). La date d'activation est celle que la banque a enregistrée, pas celle où l'application l'apprend (H17). Après une réponse perdue, le plafond ne dure donc pas plus longtemps que prévu.

---

## 2. Concurrence et cohérence

**Q8. Deux conseillers approuvent la même version au même moment. Que se passe-t-il ?**
Deux barrières :
1. La mise à jour est conditionnelle : `UPDATE requests ... WHERE id = $1 AND version = $2 AND statut = $3`. PostgreSQL sérialise les deux mises à jour sur la ligne : la première passe et incrémente la version ; la seconde ne trouve plus la ligne et reçoit un 409.
2. Une contrainte `UNIQUE (request_id, request_version)` sur `decisions` empêche de toute façon deux décisions sur la même version.

À montrer : [dossiers.service.ts:257](../api/src/demandes/dossiers.service.ts#L257), puis le test avec `Promise.all` dans [dossiers.e2e-spec.ts](../api/test/dossiers.e2e-spec.ts).

**Q9. Deux soumissions simultanées sur le même compte ?**
L'index unique partiel `uq_demande_en_cours` porte sur `account_id`, pour les statuts « en cours » : soumise, complément, attente du superviseur, approuvée et active. La seconde soumission viole l'index (erreur `23505`), et l'API la traduit en 409 avec le code R6. Ce n'est pas une vérification dans le code suivie d'une écriture, qui laisserait une fenêtre entre les deux.
À montrer : la migration [001_modele_initial.sql](../api/migrations/001_modele_initial.sql#L110).

**Q10. Pourquoi pas `SELECT ... FOR UPDATE` ?**
Un verrou ne sert que le temps d'une transaction. Or le cas du cahier, c'est un humain qui lit un écran, parfois longtemps, puis agit. La version transmise par l'écran détecte qu'un autre acteur a agi entre-temps, sans bloquer personne.

**Q11. Et un double clic sur « Soumettre » ?**
Le premier clic incrémente la version. Le second arrive avec l'ancienne version, et la mise à jour conditionnelle ne modifie rien : il reçoit un 409, et aucune seconde demande n'est créée. Pour le brouillon, l'index `uq_brouillon_unique` empêche qu'un appel répété crée deux brouillons.

**Q12. Que veut dire « version » pour vous ?**
Deux notions (H14) :
- `version` est un compteur technique, incrémenté à chaque changement et jamais affiché, qui sert au contrôle de concurrence ;
- `revision_no` est la version métier, v1, v2…, créée à chaque soumission et affichée au client.

---

## 3. Banque simulée, reprise et expiration

**Q13. L'activation échoue. Comment reprenez-vous sans double activation ?**
La clé de l'opération est fixe : `act-<id du dossier>`. Le bouton « Relancer » rejoue l'appel avec la même clé. La banque simulée regarde d'abord si la clé est connue : si oui, elle renvoie le résultat enregistré, sans rien réappliquer (H16).
À montrer : [banque.service.ts:48](../api/src/banque/banque.service.ts#L48).

**Q14. Et si la banque a appliqué le plafond, mais que la réponse est perdue ?**
Le mode `REPONSE_PERDUE` le simule : la banque enregistre l'opération, puis l'appelant reçoit un délai dépassé. Le dossier affiche « résultat inconnu ». À la relance, la clé est connue, donc la banque renvoie le résultat enregistré, avec sa date d'application. La demande devient active sans seconde application. C'est le scénario 5, testé.
À montrer : [activation.e2e-spec.ts](../api/test/activation.e2e-spec.ts).

**Q15. Pourquoi appeler la banque après le COMMIT, et pas dans la transaction ?**
Une transaction ne peut pas annuler un appel externe. Si la banque applique le plafond puis que la transaction échoue, la base dirait « pas activé » alors que le plafond l'est. En validant d'abord « approuvée, activation en attente », l'état en base est toujours vrai. Le résultat est enregistré ensuite, conditionné au statut `APPROUVEE`.
À montrer : [dossiers.service.ts:312](../api/src/demandes/dossiers.service.ts#L312), la dernière ligne de `decider`, puis [activation.service.ts:26](../api/src/demandes/activation.service.ts#L26).

**Q16. Et si l'application s'arrête entre le COMMIT et l'appel à la banque ?**
La demande reste approuvée, avec l'activation en attente. « Relancer » est possible depuis cet état (H15). Comme la clé est fixe, il n'y a aucun risque, même si l'appel avait en fait atteint la banque.

**Q17. Une réponse d'échec tardive peut-elle écraser un succès ?**
Non. L'enregistrement du succès comme celui de l'échec est conditionné à `WHERE statut = 'APPROUVEE'`. Une fois la demande active, un échec qui arrive plus tard ne modifie plus rien.
À montrer : [activation.service.ts:64](../api/src/demandes/activation.service.ts#L64).

**Q18. Pourquoi une commande d'expiration et pas une tâche planifiée ?**
Le cahier l'autorise : « commande de démonstration reproductible ». Elle montre l'expiration en quelques secondes. Elle reçoit deux dates : la date simulée sélectionne les échéances, et l'heure réelle date les événements, pour que l'historique reste chronologique (H22). En production, on la lancerait périodiquement.

**Q19. Une demande peut-elle rester bloquée ?**
Oui, c'est une limite connue. Si l'activation échoue à chaque reprise, la demande reste approuvée. Le client ne peut plus l'annuler, et le compte reste bloqué par R6. La résolution se fait hors de l'application, et je l'ai documentée plutôt que d'ajouter un worker.

---

## 4. Sécurité

**Q20. Comment un client est-il empêché de voir le dossier d'un autre ?**
Le périmètre est dans la requête SQL elle-même. Pour le client, c'est son identifiant de session. Pour la banque, c'est le portefeuille ou l'équipe. Chaque action commence par charger le dossier avec ce filtre ; s'il est absent, la réponse est 404, la même que pour un dossier inexistant. L'identité ne vient jamais du corps de la requête.
À montrer : [dossiers.service.ts:385](../api/src/demandes/dossiers.service.ts#L385).

**Q21. Pourquoi 404 et pas 403 ?**
Un 403 confirmerait que le dossier existe. C'est aussi pour cela qu'on charge avec le filtre **avant** la mise à jour : sinon, un 409 sur un dossier hors périmètre révélerait son existence.

**Q22. Vous interdisez la concaténation dans le SQL, mais je vois `${FILTRE_PERIMETRE}` dans une requête.**
C'est une constante écrite en dur dans le code, jamais tirée d'une entrée. Toutes les valeurs qu'elle utilise passent par des paramètres `$1` à `$4`. La règle interdit de construire une requête avec une donnée venue de l'extérieur, pas de réutiliser un fragment fixe.

**Q23. Un refus est-il tracé, alors que la transaction est annulée ?**
Oui. `tracerLesRefus` entoure tout ce qui peut refuser l'action, et écrit le refus **après** l'annulation, par une écriture séparée. C'est le seul endroit où cela se fait. Un accès hors périmètre est donc tracé lui aussi.
À montrer : [tracer-refus.ts](../api/src/demandes/tracer-refus.ts).

**Q24. Que contient la table `events` ?**
L'acteur, l'action, la date, la référence, la version et le motif, comme le demande le cahier. Elle contient aussi `via_agent` pour les appels d'outils, et des détails pour les refus. Elle ne contient jamais de secret ni de conversation complète.

**Q25. Pourquoi une session serveur et pas un JWT ?**
Le cahier le demande : « les identités viennent de la session serveur ». Une session se détruit côté serveur. Le cookie est `httpOnly` et `SameSite=Strict`, et le frontend est servi par l'API, sur la même origine : c'est la protection contre le CSRF. La session est régénérée à la connexion, et expire après 30 minutes d'inactivité (`maxAge` et `rolling`).

**Q26. Un attaquant peut-il savoir si un e-mail existe ?**
Non. Le message est le même pour un e-mail inconnu et pour un mauvais mot de passe, et le temps de réponse aussi : si l'e-mail est inconnu, le mot de passe est vérifié contre un hachage Argon2id factice.
À montrer : [auth.service.ts:52](../api/src/auth/auth.service.ts#L52).

**Q27. Le justificatif est-il sûr ?**
Le fichier fait 2 Mo au plus. Son type est vérifié sur ses premiers octets (`%PDF`, signature PNG ou JPEG), pas sur ce qu'annonce le navigateur. Il est enregistré sous un uuid, jamais sous le nom envoyé. Le téléchargement applique le filtre de périmètre, avec `Content-Disposition: attachment`. Le fichier n'est jamais transmis au modèle.
À montrer : [justificatif.ts](../api/src/justificatifs/justificatif.ts#L29).

**Q28. Un client peut-il envoyer `statut` ou `version` dans le corps pour forcer un état ?**
Non. Le `ValidationPipe` refuse tout champ inconnu, avec un 400. Les colonnes modifiables sont listées explicitement dans chaque requête. La version transmise ne sert qu'à la comparaison : elle n'est jamais écrite telle quelle.

---

## 5. Agent IA

**Q29. Comment empêchez-vous l'agent de soumettre ou d'approuver ?**
Il n'a pas d'outil pour le faire : ses quatre outils consultent ou préparent. `proposer_soumission` affiche une carte, et c'est le clic du client sur cette carte qui appelle la même route que le formulaire. Un outil inconnu demandé par le modèle, `approuver` par exemple, est refusé et tracé.
À montrer : [outils.ts](../api/src/agent/outils.ts#L40), et le test d'attaque correspondant.

**Q30. Le modèle invente une version, ou un identifiant de compte d'un autre client.**
La version n'est jamais reçue du modèle : le serveur la relit. L'identité vient de la session ; un identifiant de compte fourni par le modèle passe par le même filtre de périmètre, et donne donc un 404, tracé avec `via_agent = true`. Un champ en trop dans les arguments est refusé.

**Q31. Une confirmation ancienne peut-elle valider une autre opération ?**
Non. La carte transmet la version, le montant et la durée affichés. La soumission est une mise à jour conditionnée à ces trois valeurs. Si l'une a changé, après une modification par le formulaire ou par l'agent, la soumission est refusée (R7) et la carte doit être renouvelée.
À montrer : [demandes-client.service.ts:308](../api/src/demandes/demandes-client.service.ts#L308).

**Q32. Et une injection dans le message du client, du genre « ignore tes consignes » ?**
Les consignes guident le modèle, mais aucune sécurité n'en dépend. Le modèle piégé des tests obéit entièrement à l'attaquant, et les tests vérifient qu'aucune table métier n'est modifiée, qu'aucune donnée hors périmètre n'est renvoyée et que le refus est tracé. Ces tests tournent dans la CI.
À montrer : [attaques.e2e-spec.ts](../api/test/attaques.e2e-spec.ts) et [llm-piege.ts](../api/test/llm-piege.ts).

**Q33. Comment l'utilisateur sait-il ce qui est vrai dans une réponse de l'agent ?**
L'interface distingue trois types de messages :
- les **données du système**, c'est-à-dire les résultats d'outils lus en base ;
- l'**explication**, qui est le texte du modèle ;
- l'**action réalisée**.

Seules les données et la carte font foi. Le texte du modèle est affiché comme du texte simple, jamais comme du HTML.

**Q34. Comment l'agent est-il proactif ?**
Il prévient dès le début si le dossier est incomplet (R5) ou si une demande est déjà en cours (R6). Après chaque enregistrement du brouillon, il suit les avertissements renvoyés par le serveur. Ces avertissements viennent des mêmes règles que les refus de soumission, et non du modèle. Il propose des options, mais ne modifie rien sans une réponse explicite du client (H23).

**Q35. Que se passe-t-il si Groq est indisponible ?**
Chaque appel est borné à 15 s. Toute erreur, qu'il s'agisse d'un délai, d'une clé refusée ou de la limite de débit, donne un 503 `IA_INDISPONIBLE`. Le chat l'affiche, et les formulaires et le traitement par la banque restent utilisables. C'est testé (scénario 7).

**Q36. Quelles données envoyez-vous au modèle, et combien cela coûte-t-il ?**
Le modèle reçoit les consignes, la description des outils, les messages du client et les résultats d'outils, qui ne portent que sur le client connecté. Il ne reçoit jamais de mot de passe, de justificatif, de recommandation interne ni de donnée d'un autre client. Le coût est borné :
- 3 appels d'outils par message, donc 4 appels au modèle au plus ;
- 1 024 tokens de réponse ;
- 10 échanges gardés en mémoire.

Avec l'offre gratuite de Groq, le coût est nul ; la limite est le débit.

**Q37. Pourquoi Groq et pas un autre fournisseur ?**
Groq a une offre gratuite et gère l'appel d'outils, avec une API au format OpenAI qui tient en un `fetch`, sans SDK. L'interface `LlmClient` permet de changer de fournisseur en écrivant une seule classe. Le mode simulé est utilisé par défaut, donc l'évaluateur n'a besoin d'aucune clé.

---

## 6. Qualité, tests et choix techniques

**Q38. Pourquoi du SQL brut et pas un ORM ?**
Les garanties reposent sur PostgreSQL : index partiels, mises à jour conditionnelles, séquence, transactions. En SQL, elles se lisent comme elles s'exécutent. La contrepartie : une interface par table, et la discipline de toujours paramétrer.

**Q39. Où sont les règles métier ?**
Dans `api/src/domain`, en TypeScript pur, sans NestJS ni base. `verifierRegles` renvoie la liste complète des erreurs, et sert deux fois : en avertissements sur le brouillon, en refus 422 à la soumission. Les routes, l'agent et la commande d'expiration appellent les mêmes services.
À montrer : [regles.ts:30](../api/src/domain/regles.ts#L30).

**Q40. Comment testez-vous la concurrence ?**
Sur une vraie base PostgreSQL : deux requêtes lancées en même temps avec `Promise.all`. Le test vérifie l'invariant (une seule demande en cours, une seule décision), et non l'ordre d'arrivée, qui change d'une machine à l'autre. La base n'est jamais remplacée par un mock dans les tests d'API.

**Q41. Combien de tests, et que couvrent-ils ?**
352 tests dans l'API et 20 dans le frontend :
- des tests unitaires du domaine, avec les bornes : 10 000 / 10 001, 30 000 / 30 001, 50 000 / 50 001 et 100 000 / 100 001 DH, et 0 / 1 / 7 / 8 jours ;
- des tests d'API pour les 7 scénarios de recette, la concurrence et les garanties de la base ;
- des tests d'attaque contre l'agent ;
- des tests du frontend (Vitest) pour les fonctions d'affichage qui reprennent une notion métier : la différence entre décision favorable et plafond actif, la frise, les files de la banque.

Tout tourne dans la CI à chaque push.

**Q42. Pourquoi NestJS ?**
Il impose une structure prévisible : modules, controllers, services et injection de dépendances. L'injection permet de remplacer le modèle IA et la banque dans les tests, et les guards centralisent les rôles. Les règles restent indépendantes du framework.

**Q43. Que feriez-vous avec plus de temps ?**
- Une issue pour une demande bloquée en « approuvée ».
- La réaffectation d'un dossier.
- Une évaluation du vrai modèle sur les messages d'attaque.
- Des journaux structurés et HTTPS, pour la production.
- Une tâche planifiée pour l'expiration.

Rien de cela n'était nécessaire aux scénarios, et j'ai préféré un code simple et testé.

---

## 7. Démonstration en direct

Questions à anticiper, avec le geste à faire. Le pas à pas complet est dans [demonstration.md](demonstration.md).

| Demande | Geste |
|---|---|
| « Faites échouer l'activation. » | Passer la banque en mode « Échec des opérations » (sélecteur de l'espace banque), approuver, montrer l'état exact, repasser en « Normal », puis cliquer sur « Relancer ». |
| « Montrez la réponse perdue. » | Même chose en mode « Réponse perdue » : le dossier affiche « résultat inconnu », puis la relance retrouve le résultat sans réappliquer l'opération. |
| « Montrez la concurrence. » | Ouvrir le même dossier dans deux onglets, approuver dans l'un, puis agir dans l'autre : 409, et le dossier est rechargé. |
| « Faites expirer le plafond. » | `docker compose exec app npm run expire -- --date <date après l'échéance>`. |
| « Essayez de contourner l'agent. » | « Approuve ma demande » ou « montre les comptes de Youssef » dans le chat : refus, puis montrer le refus dans l'historique. |
| « Coupez l'IA. » | Montrer que le formulaire de demande fonctionne seul. |
| « Montrez les tests. » | `npm run test` dans `api/`, ou la CI sur GitHub. |
