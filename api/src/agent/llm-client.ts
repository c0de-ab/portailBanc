// Le contrat entre l'agent et un modèle de langage. Trois
// implémentations : connectée (API Groq), simulée et déterministe (par défaut), et un modèle
// piégé réservé aux tests (api/test/). Le reste de l'agent ne connaît que ce contrat.

// Garde-fou : un appel au modèle ne dure jamais plus de 15 s. L'agent coupe l'attente, et le
// client Groq interrompt aussi sa requête HTTP, avec cette même valeur.
export const DELAI_MODELE_MS = 15_000;

// Une demande d'appel d'outil faite par le modèle. Les arguments sont des données NON FIABLES :
// ils sont validés avant tout usage.
export type AppelOutil = { id: string; nom: string; arguments: unknown };

export type MessageModele =
  | { role: 'client'; texte: string }
  | { role: 'agent'; texte: string; appels: AppelOutil[] }
  | { role: 'outil'; idAppel: string; nom: string; resultat: unknown; erreur: boolean };

export type DescriptionOutil = {
  nom: string;
  description: string;
  // Schéma JSON des arguments, transmis au modèle connecté.
  schema: Record<string, unknown>;
};

export type ReponseModele = { texte: string; appels: AppelOutil[] };

export interface LlmClient {
  repondre(entree: {
    consignes: string;
    messages: MessageModele[];
    outils: DescriptionOutil[];
  }): Promise<ReponseModele>;
}

// Le jeton d'injection NestJS de l'implémentation choisie par LLM_MODE.
export const LLM_CLIENT = Symbol('LlmClient');
