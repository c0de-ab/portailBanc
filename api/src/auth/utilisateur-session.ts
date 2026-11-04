// Ce que la session retient de l'utilisateur connecté : une copie prise à la connexion,
// sans relecture de la base à chaque requête. Un changement de rôle ne prend donc effet
// qu'à la connexion suivante (limite connue). Le statut du dossier client (R5) n'est
// volontairement PAS ici : il est toujours relu en base au moment de la soumission.
export type Role = 'CLIENT' | 'CONSEILLER' | 'SUPERVISEUR';

export type UtilisateurSession = {
  id: string;
  displayName: string;
  roles: Role[];
  // Équipe du conseiller ou du superviseur ; nulle pour un client.
  teamId: string | null;
  // Dossier client de l'utilisateur ; nul pour le personnel de la banque.
  clientId: string | null;
};

// Déclare le contenu de la session pour TypeScript (express-session).
declare module 'express-session' {
  interface SessionData {
    utilisateur?: UtilisateurSession;
  }
}
