// Une règle non respectée, au format des erreurs de l'API (CLAUDE.md, règle 8).
// `code` : le code de la règle (R1…R14) ou TRANSITION pour une transition impossible.
// `champ` : le champ concerné, absent quand l'erreur ne porte sur aucun champ.
// `message` : en français, écrit pour la personne qui lit l'erreur.
export type CodeErreur =
  'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R8' | 'R9' | 'R10' | 'R12' | 'R13' | 'TRANSITION';

export type ErreurRegle = {
  code: CodeErreur;
  champ?: string;
  message: string;
};

// Montant lisible en français : 30000 -> « 30 000 DH ».
export function enDirhams(montant: number): string {
  return `${montant.toLocaleString('fr-FR')} DH`;
}
