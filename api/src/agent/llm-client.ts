// Le contrat entre l'agent et un modèle de langage (CLAUDE.md, section Agent IA). Trois
// implémentations : connectée (SDK Anthropic, étape 7c), simulée et déterministe (par défaut),
// et un modèle piégé réservé aux tests (api/test/). Le reste de l'agent ne connaît que ce contrat.

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
