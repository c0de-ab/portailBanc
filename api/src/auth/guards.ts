import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ErreurApi } from '../http/erreur-api';
import type { Role, UtilisateurSession } from './utilisateur-session';

// L'identité vient UNIQUEMENT de la session (CLAUDE.md, règle 3) : jamais du corps de la
// requête, d'un paramètre d'URL ou du modèle IA.
function utilisateurDeLaSession(contexte: ExecutionContext): UtilisateurSession | undefined {
  return contexte.switchToHttp().getRequest<Request>().session?.utilisateur;
}

function nonConnecte(): ErreurApi {
  return new ErreurApi(HttpStatus.UNAUTHORIZED, [
    { code: 'AUTH', message: 'Vous devez être connecté.' },
  ]);
}

// Refuse toute requête sans utilisateur connecté (401 AUTH).
@Injectable()
export class ConnecteGuard implements CanActivate {
  canActivate(contexte: ExecutionContext): boolean {
    if (!utilisateurDeLaSession(contexte)) {
      throw nonConnecte();
    }
    return true;
  }
}

const CLE_ROLES = 'roles';

// @Roles('CONSEILLER', 'SUPERVISEUR') : l'un de ces rôles suffit.
export const Roles = (...roles: Role[]) => SetMetadata(CLE_ROLES, roles);

// Refuse un utilisateur non connecté (401 AUTH), puis un utilisateur qui n'a aucun des
// rôles demandés par @Roles (403 ROLE). Sans @Roles, il suffit d'être connecté.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflecteur: Reflector) {}

  canActivate(contexte: ExecutionContext): boolean {
    const utilisateur = utilisateurDeLaSession(contexte);
    if (!utilisateur) {
      throw nonConnecte();
    }
    const requis = this.reflecteur.getAllAndOverride<Role[] | undefined>(CLE_ROLES, [
      contexte.getHandler(),
      contexte.getClass(),
    ]);
    if (requis && !requis.some((role) => utilisateur.roles.includes(role))) {
      throw new ErreurApi(HttpStatus.FORBIDDEN, [
        { code: 'ROLE', message: "Votre rôle ne permet pas d'effectuer cette action." },
      ]);
    }
    return true;
  }
}

// @UtilisateurConnecte() dans un controller : l'utilisateur de la session.
// À utiliser derrière ConnecteGuard ou RolesGuard, qui garantissent sa présence.
export const UtilisateurConnecte = createParamDecorator(
  (_donnees: unknown, contexte: ExecutionContext): UtilisateurSession => {
    const utilisateur = utilisateurDeLaSession(contexte);
    if (!utilisateur) {
      throw nonConnecte();
    }
    return utilisateur;
  },
);
