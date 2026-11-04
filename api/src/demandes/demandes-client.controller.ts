import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles, RolesGuard, UtilisateurConnecte } from '../auth/guards';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import { vueClient } from './demande';
import { ModifierDemandeDto, SoumettreDto, VersionDto } from './demandes-client.dto';
import { DemandesClientService } from './demandes-client.service';

// Les routes du client. Aucune logique métier ici (CLAUDE.md, règle 2) : le controller lit
// l'identité dans la session, passe la date courante au service et met en forme la réponse.
@Controller()
@UseGuards(RolesGuard)
@Roles('CLIENT')
export class DemandesClientController {
  constructor(private readonly demandes: DemandesClientService) {}

  @Get('comptes')
  async comptes(@UtilisateurConnecte() client: UtilisateurSession) {
    return { comptes: await this.demandes.comptes(client) };
  }

  // 201 si le brouillon vient d'être créé, 200 s'il existait déjà.
  @Post('comptes/:compteId/brouillon')
  async brouillon(
    @UtilisateurConnecte() client: UtilisateurSession,
    @Param('compteId', ParseUUIDPipe) compteId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { demande, avertissements, cree } = await this.demandes.obtenirBrouillon(
      client,
      compteId,
      new Date(),
    );
    res.status(cree ? HttpStatus.CREATED : HttpStatus.OK);
    return { demande: vueClient(demande), avertissements };
  }

  @Get('demandes')
  async lister(@UtilisateurConnecte() client: UtilisateurSession) {
    return { demandes: (await this.demandes.lister(client)).map(vueClient) };
  }

  @Get('demandes/:id')
  async detail(
    @UtilisateurConnecte() client: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const detail = await this.demandes.detail(client, id, new Date());
    return { ...detail, demande: vueClient(detail.demande) };
  }

  @Patch('demandes/:id')
  async modifier(
    @UtilisateurConnecte() client: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() entree: ModifierDemandeDto,
  ) {
    const { version, ...contenu } = entree;
    const { demande, avertissements } = await this.demandes.modifier(
      client,
      id,
      version,
      contenu,
      new Date(),
    );
    return { demande: vueClient(demande), avertissements };
  }

  @Post('demandes/:id/soumettre')
  @HttpCode(HttpStatus.OK)
  async soumettre(
    @UtilisateurConnecte() client: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() confirmation: SoumettreDto,
  ) {
    return {
      demande: vueClient(await this.demandes.soumettre(client, id, confirmation, new Date())),
    };
  }

  @Post('demandes/:id/abandonner')
  @HttpCode(HttpStatus.OK)
  async abandonner(
    @UtilisateurConnecte() client: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { version }: VersionDto,
  ) {
    return { demande: vueClient(await this.demandes.abandonner(client, id, version, new Date())) };
  }

  @Post('demandes/:id/annuler')
  @HttpCode(HttpStatus.OK)
  async annuler(
    @UtilisateurConnecte() client: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { version }: VersionDto,
  ) {
    return { demande: vueClient(await this.demandes.annuler(client, id, version, new Date())) };
  }
}
