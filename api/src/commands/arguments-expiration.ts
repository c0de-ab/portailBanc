// La date simulée de `npm run expire -- --date <date>` (H22). Fonction pure : testable seule.

// Une erreur d'utilisation de la commande : son message suffit, sans pile d'appels.
export class ErreurArguments extends Error {}

const DATE_SEULE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ET_HEURE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const USAGE =
  'Usage : npm run expire -- --date <AAAA-MM-JJ ou date ISO avec fuseau, ex. 2026-11-08T09:00:00Z>';

// Lit --date dans les arguments. Une date seule désigne la FIN de cette journée en UTC :
// « --date 2026-11-08 » expire tout ce qui arrive à échéance le 8 novembre. Une date avec heure
// est prise telle quelle. Une date antérieure à l'heure réelle est refusée.
export function lireDateSimulee(args: string[], maintenant: Date): Date {
  const position = args.indexOf('--date');
  const valeur = position >= 0 ? args[position + 1] : undefined;
  if (!valeur) {
    throw new ErreurArguments(`Date simulée manquante. ${USAGE}`);
  }

  let date: Date;
  if (DATE_SEULE.test(valeur)) {
    date = new Date(`${valeur}T23:59:59.999Z`);
    // Une date impossible (2026-02-30) serait reportée au mois suivant : elle est refusée.
    if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(valeur)) {
      throw new ErreurArguments(`Date simulée invalide : ${valeur}. ${USAGE}`);
    }
  } else if (DATE_ET_HEURE.test(valeur)) {
    date = new Date(valeur);
    if (Number.isNaN(date.getTime())) {
      throw new ErreurArguments(`Date simulée invalide : ${valeur}. ${USAGE}`);
    }
  } else {
    throw new ErreurArguments(`Date simulée invalide : ${valeur}. ${USAGE}`);
  }

  // H22 : jamais de date dans le passé, la chronologie de l'historique resterait incohérente.
  if (date.getTime() < maintenant.getTime()) {
    throw new ErreurArguments(
      `La date simulée (${date.toISOString()}) est antérieure à l'heure réelle (${maintenant.toISOString()}).`,
    );
  }
  return date;
}
