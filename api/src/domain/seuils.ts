// Les seuils des règles fictives, nommés une seule fois.
// Le plafond initial n'est pas ici : il est lu sur le compte (accounts.plafond_initial, H11).

// R1 : le plafond demandé est au plus égal à ce montant.
export const PLAFOND_MAXIMUM = 100_000;

// R8 : jusqu'à ce montant inclus, le conseiller décide ; au-delà, le superviseur.
export const SEUIL_DECISION_CONSEILLER = 30_000;

// R4 : au-delà de ce montant, un justificatif est obligatoire.
export const SEUIL_JUSTIFICATIF = 50_000;

// R2 : durée en jours, bornes incluses.
export const DUREE_MINIMUM_JOURS = 1;
export const DUREE_MAXIMUM_JOURS = 7;
