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
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Roles, RolesGuard, UtilisateurConnecte } from '../auth/guards';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import {
  envoyerJustificatif,
  type FichierRecu,
  TAILLE_MAXIMUM,
} from '../justificatifs/justificatif';
import { vueClient } from './demande';
import {
  ModifierDemandeDto,
  SoumettreDto,
  VersionDto,
  VersionFormulaireDto,
} from './demandes-client.dto';
import { DemandesClientService } from './demandes-client.service';
import { JustificatifsClientService } from './justificatifs-client.service';
import { SoumissionService } from './soumission.service';

// Les routes du client. Aucune logique métier ici : le controller lit
// l'identité dans la session, passe la date courante au service et met en forme la réponse.
@Controller()
@UseGuards(RolesGuard)
@Roles('CLIENT')
export class DemandesClientController {
  constructor(
    private readonly demandes: DemandesClientService,
    private readonly soumission: SoumissionService,
    private readonly justificatifs: JustificatifsClientService,
  ) {}

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
      demande: vueClient(await this.soumission.soumettre(client, id, confirmation, new Date())),
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

  // Formulaire multipart : le fichier dans le champ « fichier », et la version.
  // Multer garde le fichier en mémoire (2 Mo au plus, un seul fichier) : rien n'est écrit sur
  // le disque avant les contrôles du service. Au-delà de 2 Mo : 413.
  @Put('demandes/:id/justificatif')
  @UseInterceptors(
    FileInterceptor('fichier', {
      limits: { fileSize: TAILLE_MAXIMUM, files: 1, fields: 5 },
      // Les navigateurs envoient le nom en UTF-8 ; Multer le lirait en latin-1 par défaut
      // (« facture-été.pdf » deviendrait « facture-Ã©tÃ©.pdf »).
      defParamCharset: 'utf8',
    }),
  )
  async deposerJustificatif(
    @UtilisateurConnecte() client: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { version }: VersionFormulaireDto,
    @UploadedFile() fichier: FichierRecu | undefined,
  ) {
    const { demande, avertissements } = await this.justificatifs.deposer(
      client,
      id,
      version,
      fichier,
      new Date(),
    );
    return { demande: vueClient(demande), avertissements };
  }

  // Téléchargement : toujours en pièce jointe, jamais affiché dans la page, et jamais en cache.
  @Get('demandes/:id/justificatif')
  async telechargerJustificatif(
    @UtilisateurConnecte() client: UtilisateurSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    envoyerJustificatif(res, await this.justificatifs.lire(client, id, new Date()));
  }
}
