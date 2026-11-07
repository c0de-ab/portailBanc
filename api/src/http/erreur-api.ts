import { HttpException } from '@nestjs/common';

// Une erreur au format unique de l'API :
// { erreurs: [{ code, champ?, message }] }. `champ` est absent quand l'erreur ne porte
// sur aucun champ (une erreur de version, par exemple).
export type ErreurDetaillee = {
  code: string;
  champ?: string;
  message: string;
};

// À lever par les services et les controllers : le filtre d'exceptions renvoie `erreurs`
// telles quelles, avec le statut HTTP donné.
export class ErreurApi extends HttpException {
  constructor(
    statut: number,
    readonly erreurs: ErreurDetaillee[],
  ) {
    super({ erreurs }, statut);
  }
}
