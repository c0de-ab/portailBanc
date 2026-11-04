import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErreurApi } from '../http/erreur-api';
import { AuthService } from './auth.service';
import { ConnexionDto } from './connexion.dto';
import { ConnecteGuard, UtilisateurConnecte } from './guards';
import {
  detruireSession,
  enregistrerSession,
  NOM_COOKIE_SESSION,
  regenererSession,
} from './session';
import type { UtilisateurSession } from './utilisateur-session';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // POST /api/auth/connexion. Même réponse pour un e-mail inconnu et un mauvais mot de passe.
  @Post('connexion')
  @HttpCode(HttpStatus.OK)
  async connecter(
    @Body() entree: ConnexionDto,
    @Req() req: Request,
  ): Promise<{ utilisateur: UtilisateurSession }> {
    const utilisateur = await this.auth.verifierIdentifiants(
      entree.email,
      entree.motDePasse,
      new Date(),
    );
    if (!utilisateur) {
      throw new ErreurApi(HttpStatus.UNAUTHORIZED, [
        { code: 'AUTH', message: 'E-mail ou mot de passe incorrect.' },
      ]);
    }

    // Nouvel identifiant de session à la connexion : un identifiant connu avant
    // (fixation de session) ne donne jamais accès au compte.
    await regenererSession(req);
    req.session.utilisateur = utilisateur;
    await enregistrerSession(req);
    return { utilisateur };
  }

  // POST /api/auth/deconnexion : la session est détruite côté serveur, pas seulement oubliée.
  @Post('deconnexion')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deconnecter(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const utilisateur = req.session.utilisateur;
    await detruireSession(req);
    res.clearCookie(NOM_COOKIE_SESSION);
    if (utilisateur) {
      await this.auth.tracerDeconnexion(utilisateur.id, new Date());
    }
  }

  // GET /api/auth/moi : l'utilisateur connecté, tel que la session le connaît.
  @Get('moi')
  @UseGuards(ConnecteGuard)
  moi(@UtilisateurConnecte() utilisateur: UtilisateurSession): { utilisateur: UtilisateurSession } {
    return { utilisateur };
  }
}
