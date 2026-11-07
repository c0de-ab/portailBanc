// Calculs de dates du domaine. Les dates sont toujours reçues en paramètre :
// jamais d'heure courante lue ici.

const MILLISECONDES_PAR_HEURE = 60 * 60 * 1000;

// H8 : échéance = date d'activation + durée × 24 h. Une durée glissante, indépendante du
// fuseau horaire : 3 jours courent 72 heures à partir de l'application par la banque (H17).
export function calculerEcheance(dateActivation: Date, dureeJours: number): Date {
  return new Date(dateActivation.getTime() + dureeJours * 24 * MILLISECONDES_PAR_HEURE);
}

// H13 : référence DEM-<année de la soumission>-<numéro de la séquence sur 6 chiffres>.
// L'année est lue en UTC, comme toutes les dates du projet.
export function formaterReference(dateSoumission: Date, numero: number): string {
  return `DEM-${dateSoumission.getUTCFullYear()}-${String(numero).padStart(6, '0')}`;
}
