import { HttpStatus } from '@nestjs/common';
import type { CodeErreur, ErreurRegle } from '../domain/erreurs';
import { ErreurApi } from '../http/erreur-api';

// Le statut HTTP de chaque code de règle (CLAUDE.md, règle 8), en un seul endroit.
const STATUT_PAR_CODE: Record<CodeErreur | 'R6' | 'R7' | 'R11' | 'R14', number> = {
  R1: HttpStatus.UNPROCESSABLE_ENTITY,
  R2: HttpStatus.UNPROCESSABLE_ENTITY,
  R3: HttpStatus.UNPROCESSABLE_ENTITY,
  R4: HttpStatus.UNPROCESSABLE_ENTITY,
  R5: HttpStatus.UNPROCESSABLE_ENTITY,
  R10: HttpStatus.UNPROCESSABLE_ENTITY,
  R6: HttpStatus.CONFLICT,
  R7: HttpStatus.CONFLICT,
  R11: HttpStatus.CONFLICT,
  R12: HttpStatus.CONFLICT,
  R13: HttpStatus.CONFLICT,
  TRANSITION: HttpStatus.CONFLICT,
  R8: HttpStatus.FORBIDDEN,
  R9: HttpStatus.FORBIDDEN,
  R14: HttpStatus.NOT_FOUND,
};

type CodeRefus = keyof typeof STATUT_PAR_CODE;

// Transforme des erreurs de règles en erreur de l'API. Le statut est celui de la première
// erreur : toutes les erreurs de contenu (R1 à R5) partagent d'ailleurs le même, 422.
export function refuser(
  erreurs: (ErreurRegle | { code: CodeRefus; champ?: string; message: string })[],
): ErreurApi {
  return new ErreurApi(STATUT_PAR_CODE[erreurs[0].code], erreurs);
}

// R14 : hors périmètre ou inexistant, la même réponse (CLAUDE.md, règle 4).
export function introuvable(): ErreurApi {
  return refuser([{ code: 'R14', message: 'Demande introuvable.' }]);
}

// R11 : l'action porte sur une version qui n'est plus la version actuelle.
export function versionPerimee(): ErreurApi {
  return refuser([
    {
      code: 'R11',
      message: 'La demande a changé depuis votre dernière lecture : rechargez-la avant d’agir.',
    },
  ]);
}
