import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles, RolesGuard, UtilisateurConnecte } from '../auth/guards';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import { envoyerJustificatif } from '../justificatifs/justificatif';
import { vueDossier } from './demande';
import { DecisionDto, RecommandationDto } from './dossiers.dto';
import { type ActionDecision, DossiersService } from './dossiers.service';

// Les routes du personnel de la banque. Aucune logique métier ici (CLAUDE.md, règle 2).
@Controller('dossiers')
@UseGuards(RolesGuard)
@Roles('CONSEILLER', 'SUPERVISEUR')
export class DossiersController {
  constructor(private readonly dossiers: DossiersService) {}

  @Get()
  async lister(@UtilisateurConnecte() agent: UtilisateurSession) {
    return { dossiers: (await this.dossiers.lister(agent)).map(vueDossier) };
  }

  @Get(':id')
  async detail(
    @UtilisateurConnecte() agent: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const detail = await this.dossiers.detail(agent, id, new Date());
    return { ...detail, demande: vueDossier(detail.demande) };
  }

  @Get(':id/justificatif')
  async telechargerJustificatif(
    @UtilisateurConnecte() agent: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    envoyerJustificatif(res, await this.dossiers.lireJustificatif(agent, id, new Date()));
  }

  @Post(':id/demander-complement')
  @HttpCode(HttpStatus.OK)
  demanderComplement(
    @UtilisateurConnecte() agent: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() entree: DecisionDto,
  ) {
    return this.decider(agent, id, 'demanderComplement', entree);
  }

  @Post(':id/approuver')
  @HttpCode(HttpStatus.OK)
  approuver(
    @UtilisateurConnecte() agent: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() entree: DecisionDto,
  ) {
    return this.decider(agent, id, 'approuver', entree);
  }

  @Post(':id/rejeter')
  @HttpCode(HttpStatus.OK)
  rejeter(
    @UtilisateurConnecte() agent: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() entree: DecisionDto,
  ) {
    return this.decider(agent, id, 'rejeter', entree);
  }

  @Post(':id/recommander')
  @HttpCode(HttpStatus.OK)
  async recommander(
    @UtilisateurConnecte() agent: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() entree: RecommandationDto,
  ) {
    const demande = await this.dossiers.decider(
      agent,
      id,
      'recommander',
      entree.version,
      entree.motif,
      new Date(),
      entree.avis,
    );
    return { demande: vueDossier(demande) };
  }

  private async decider(
    agent: UtilisateurSession,
    id: string,
    action: ActionDecision,
    entree: DecisionDto,
  ) {
    const demande = await this.dossiers.decider(
      agent,
      id,
      action,
      entree.version,
      entree.motif,
      new Date(),
    );
    return { demande: vueDossier(demande) };
  }
}
