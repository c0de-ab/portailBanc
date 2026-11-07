import { HttpStatus, ValidationPipe, type ValidationError } from '@nestjs/common';
import { ErreurApi, type ErreurDetaillee } from './erreur-api';

// Validation de toutes les entrées :
// - whitelist + forbidNonWhitelisted : un champ non déclaré dans le DTO (statut, version…)
//   est refusé, jamais ignoré en silence ;
// - transform : le corps devient une instance du DTO, avec les types déclarés.
// Une entrée mal formée renvoie 400 VALIDATION, avec une erreur par champ.
export function creerValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (erreurs) => new ErreurApi(HttpStatus.BAD_REQUEST, enErreursApi(erreurs)),
  });
}

// Aplatit les erreurs de class-validator (les champs imbriqués donnent « adresse.ville »).
function enErreursApi(erreurs: ValidationError[], parent = ''): ErreurDetaillee[] {
  return erreurs.flatMap((erreur) => {
    const champ = parent ? `${parent}.${erreur.property}` : erreur.property;
    const propres = Object.entries(erreur.constraints ?? {}).map(([contrainte, message]) => ({
      code: 'VALIDATION',
      champ,
      message:
        contrainte === 'whitelistValidation' ? `Le champ « ${champ} » n'est pas accepté.` : message,
    }));
    return [...propres, ...enErreursApi(erreur.children ?? [], champ)];
  });
}
