import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErreurApi, type ErreurDetaillee } from './erreur-api';

// Code et message pour les erreurs HTTP qui ne viennent pas d'une règle métier
// (route inconnue, rôle refusé par un guard…).
const ERREURS_GENERIQUES: Record<number, ErreurDetaillee> = {
  [HttpStatus.BAD_REQUEST]: { code: 'VALIDATION', message: 'Requête invalide.' },
  [HttpStatus.UNAUTHORIZED]: { code: 'AUTH', message: 'Vous devez être connecté.' },
  [HttpStatus.FORBIDDEN]: {
    code: 'ROLE',
    message: "Vous n'avez pas le droit d'effectuer cette action.",
  },
  [HttpStatus.NOT_FOUND]: { code: 'INTROUVABLE', message: "Cette ressource n'existe pas." },
};

const ERREUR_INTERNE: ErreurDetaillee = {
  code: 'ERREUR_INTERNE',
  message: 'Une erreur inattendue est survenue. Réessayez plus tard.',
};

// Toutes les erreurs de l'API sortent au même format : { erreurs: [{ code, champ?, message }] }.
// Une erreur inattendue renvoie un 500 sans aucun détail technique ; le détail va dans le journal.
@Catch()
export class FiltreErreurs implements ExceptionFilter {
  private readonly journal = new Logger(FiltreErreurs.name);

  catch(exception: unknown, hote: ArgumentsHost): void {
    const reponse = hote.switchToHttp().getResponse<Response>();

    if (exception instanceof ErreurApi) {
      reponse.status(exception.getStatus()).json({ erreurs: exception.erreurs });
      return;
    }

    if (exception instanceof HttpException) {
      const statut = exception.getStatus();
      const erreur = ERREURS_GENERIQUES[statut] ?? {
        code: `HTTP_${statut}`,
        message: exception.message,
      };
      reponse.status(statut).json({ erreurs: [erreur] });
      return;
    }

    // Jamais de secret ici : le journal reçoit l'erreur, la réponse n'en dit rien.
    this.journal.error(exception instanceof Error ? exception.stack : String(exception));
    reponse.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ erreurs: [ERREUR_INTERNE] });
  }
}
