# Choix techniques 

Une courte explication des choix de données, de concurrence, de reprise et d'intégration IA. Le détail est dans le [README](../README.md) : § 5 pour les données, la concurrence et la reprise, et § 6 pour l'intégration IA.

## Données

PostgreSQL et du SQL brut, sans ORM. Les règles critiques reposent sur la base elle-même : index uniques partiels, mises à jour conditionnelles, séquence des références. Écrites en SQL, elles se lisent exactement comme elles s'exécutent.

- **Montants en dirhams entiers**, sans arrondi possible.
- **Rien n'est jamais supprimé.** Un brouillon abandonné change d'état, et les justificatifs restent, parce que les révisions y font référence.
- **Deux tables pour une demande.** La copie en cours d'édition (`requests`) est séparée des révisions soumises (`request_revisions` : v1, v2…).
- **Deux compteurs distincts.** Un compteur technique (`version`), jamais affiché, sert au contrôle de concurrence. Le numéro de révision est celui que voit l'utilisateur.
- **Un historique complet** (`events`) de chaque transition, décision, appel d'outil de l'agent et refus, sans secret ni conversation.

**Écarté : un ORM.** Il aurait traduit les index partiels et les mises à jour conditionnelles sans rien apporter, et caché ce qui garantit les règles.

## Concurrence

Un contrôle optimiste : aucun verrou n'est posé pendant qu'un utilisateur lit ou modifie un dossier. Chaque action est une mise à jour conditionnelle :

```sql
UPDATE requests SET … WHERE id = $1 AND version = $2 AND statut = $3
```

Si aucune ligne n'est modifiée, un autre utilisateur a agi avant : l'action est refusée (409), et l'écran recharge le dossier.

Ce que le code seul ne peut pas garantir sous accès simultanés, la base le garantit :
- une seule demande en cours par compte : index unique partiel ;
- un seul brouillon par compte : index unique partiel ;
- une seule décision par version : contrainte unique ;
- une seule opération bancaire par clé : clé primaire ;
- un dossier client qui reste complet pendant la soumission (R5) : relu dans la transaction, avec un verrou partagé (`FOR SHARE`).

Les tests le vérifient avec deux requêtes réellement simultanées, sur une vraie base PostgreSQL. Ils affirment l'invariant, et non l'ordre d'arrivée.

**Écarté : le verrouillage pessimiste du dossier** (`SELECT … FOR UPDATE` pendant qu'un utilisateur le consulte). Un conseiller qui laisse un dossier ouvert bloquerait les autres. Le contrôle optimiste ne bloque personne, et refuse seulement l'action fondée sur une version périmée.

## Reprise

La banque est traitée comme un système externe peu fiable : elle peut échouer, ou appliquer l'opération sans que la réponse arrive.

- **Une clé fixe par opération** (`act-<id>`, `desact-<id>`). Une clé déjà connue renvoie toujours le résultat enregistré par la banque : une relance ne peut pas activer deux fois.
- **L'état métier est séparé du résultat d'exécution.** « Approuvée » n'est pas « activation en échec » : le dossier affiche toujours la réalité, et le client voit « Décision favorable, plafond pas encore actif ».
- **Un échec tardif n'écrase jamais un succès :** les deux sont conditionnés au statut attendu.
- **Une reprise manuelle.** C'est un bouton « Relancer l'activation » plutôt qu'un worker automatique : le cahier demande qu'une reprise soit *possible* sans double activation, et un bouton se démontre et s'explique simplement. Pour l'expiration, une désactivation échouée est reprise au passage suivant de la commande.

**Écarté : un worker de reprise automatique.** Il aurait ajouté un processus, une file et des règles de nouvelle tentative, alors que la clé fixe suffit à rendre toute reprise sûre.

## Intégration IA

Le modèle propose, le serveur décide.

- **Quatre outils seulement,** qui appellent les mêmes services que les formulaires. L'agent n'a aucun pouvoir de plus qu'un formulaire.
- **L'identité vient de la session**, jamais du modèle. Les arguments des outils sont validés comme le corps d'une requête : un champ `statut` ou `version` ajouté est refusé.
- **Aucun outil n'approuve, n'active ni ne soumet.** Seul le clic du client sur la carte de confirmation soumet, par la même route que le formulaire.
- **Le modèle est derrière une interface (`LlmClient`).** Un mode simulé, déterministe, sert par défaut et dans les tests. Un mode connecté appelle Groq par `fetch`, sans SDK, avec la clé côté serveur seulement.
- **Des garde-fous bornent le coût et le délai :** 15 s par appel au modèle, 3 appels d'outils par message, 1 024 tokens de réponse par appel. Si le modèle est indisponible, le chat le dit (503), et les formulaires restent utilisables.
- **Un seul message traité à la fois par session :** deux messages simultanés ne peuvent pas s'écraser l'un l'autre dans la mémoire de l'agent.
- **Un modèle « piégé »** obéit à l'attaquant, dans les tests d'attaque lancés par la CI. Il prouve que la sécurité ne dépend pas de la bonne conduite du modèle.

**Écarté : un agent qui agit seul.** Laisser le modèle soumettre ou approuver aurait fait dépendre la sécurité de sa bonne conduite. Écarté aussi : le SDK du fournisseur, puisque l'API Groq suit un format HTTP simple et que `fetch` suffit.
