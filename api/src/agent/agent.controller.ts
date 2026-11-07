import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { Roles, RolesGuard, UtilisateurConnecte } from '../auth/guards';
import { enregistrerSession } from '../auth/session';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import { AgentService } from './agent.service';

class MessageAgentDto {
  @IsString({ message: 'Le message doit être un texte.' })
  @MinLength(1, { message: 'Le message est vide.' })
  @MaxLength(2000, { message: 'Le message ne peut pas dépasser 2 000 caractères.' })
  message!: string;
}

// Le chat du client. Le message est une DONNÉE non fiable : il ne change aucun droit.
@Controller('agent')
@UseGuards(RolesGuard)
@Roles('CLIENT')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  async envoyer(
    @UtilisateurConnecte() client: UtilisateurSession,
    @Body() { message }: MessageAgentDto,
    @Req() req: Request,
  ) {
    return this.agent.uneALaFois(req.sessionID, async () => {
      const { elements, memoire } = await this.agent.repondre(
        client,
        message,
        req.session.conversation ?? [],
        new Date(),
      );
      // La mémoire vit dans la session : supprimée à la déconnexion ou à son expiration. Elle est
      // enregistrée AVANT de libérer la session, pour que le message suivant la relise à jour.
      req.session.conversation = memoire;
      await enregistrerSession(req);
      return { elements };
    });
  }

  // « Effacer la conversation » : la mémoire du modèle est retirée de la session, pour que
  // l'assistant reparte vraiment de zéro. La connexion, elle, reste ouverte.
  @Delete('conversation')
  @HttpCode(HttpStatus.NO_CONTENT)
  // Même verrou que les messages : un message en cours ne réécrit pas la mémoire juste effacée.
  effacer(@Req() req: Request) {
    return this.agent.uneALaFois(req.sessionID, async () => {
      delete req.session.conversation;
      await enregistrerSession(req);
    });
  }
}
