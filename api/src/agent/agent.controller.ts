import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { Roles, RolesGuard, UtilisateurConnecte } from '../auth/guards';
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
    const { elements, memoire } = await this.agent.repondre(
      client,
      message,
      req.session.conversation ?? [],
      new Date(),
    );
    // La mémoire vit dans la session : supprimée à la déconnexion ou à son expiration.
    req.session.conversation = memoire;
    return { elements };
  }
}
