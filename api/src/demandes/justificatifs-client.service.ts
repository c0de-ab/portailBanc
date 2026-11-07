import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import { BaseService } from '../base/base.service';
import { ErreurApi } from '../http/erreur-api';
import { HistoriqueService } from '../historique/historique.service';
import {
  cheminDe,
  detecterType,
  dossierJustificatifs,
  type FichierRecu,
  justificatifATelecharger,
  type JustificatifATelecharger,
  nomAffichable,
  TYPE_MIME,
  type TypeJustificatif,
} from '../justificatifs/justificatif';
import {
  avertissementsDe,
  chargerDuClient,
  verifierTransition,
  verifierVersion,
} from './acces-client';
import { COLONNES_DEMANDE, type LigneDemande, versDemande } from './demande';
import type { DemandeEtAvertissements } from './demandes-client.service';
import { versionPerimee } from './refus';
import { tracerLesRefus } from './tracer-refus';

// Le justificatif du client : 2 Mo au plus, PDF, JPEG ou PNG reconnu sur ses premiers octets,
// enregistré sous un nom généré, jamais transmis au modèle IA, jamais supprimé.
@Injectable()
export class JustificatifsClientService {
  constructor(
    private readonly base: BaseService,
    private readonly historique: HistoriqueService,
  ) {}

  // Dépose le justificatif, en Brouillon ou en Complément demandé : c'est une modification du
  // contenu, la version avance. Un nouveau dépôt remplace le justificatif de la demande, mais
  // l'ancien fichier n'est jamais supprimé (une révision peut y faire référence).
  deposer(
    client: UtilisateurSession,
    id: string,
    version: number,
    fichier: FichierRecu | undefined,
    maintenant: Date,
  ): Promise<DemandeEtAvertissements> {
    return tracerLesRefus(
      this.historique,
      client,
      'deposerJustificatif',
      id,
      maintenant,
      async () => {
        const demande = await chargerDuClient(this.base, client, id);
        verifierVersion(demande, version);
        verifierTransition('modifier', demande.statut);

        const recu = controlerFichier(fichier);
        // Le nom sur le disque est généré par le serveur ; le nom d'origine ne sert qu'à
        // l'affichage.
        const nomStocke = `${randomUUID()}.${recu.type}`;
        const nomAffiche = nomAffichable(recu.fichier.originalname);
        await mkdir(dossierJustificatifs(), { recursive: true });

        const modifiee = await this.base.transaction(async (tx) => {
          const { rows } = await tx.query<LigneDemande>(
            `UPDATE requests
                SET justificatif_fichier = $5, justificatif_nom = $6,
                    version = version + 1, updated_at = $7
              WHERE id = $1 AND client_id = $2 AND version = $3 AND statut = $4
              RETURNING ${COLONNES_DEMANDE}`,
            [id, client.clientId, version, demande.statut, nomStocke, nomAffiche, maintenant],
          );
          if (!rows[0]) {
            throw versionPerimee();
          }
          // Écrit AVANT le COMMIT : si l'écriture échoue, la mise à jour est annulée.
          // « wx » : un fichier existant n'est jamais écrasé.
          await writeFile(cheminDe(nomStocke), recu.fichier.buffer, { flag: 'wx' });
          const resultat = versDemande(rows[0]);
          await this.historique.ecrire(
            {
              action: 'JUSTIFICATIF_DEPOSE',
              acteurId: client.id,
              requestId: id,
              reference: resultat.reference,
              requestVersion: resultat.version,
              details: { type: recu.type, taille: recu.fichier.size },
              date: maintenant,
            },
            tx,
          );
          return resultat;
        });

        return { demande: modifiee, avertissements: await avertissementsDe(this.base, modifiee) };
      },
    );
  }

  // Le justificatif à télécharger, après le filtre de périmètre (404 sinon).
  lire(
    client: UtilisateurSession,
    id: string,
    maintenant: Date,
  ): Promise<JustificatifATelecharger> {
    return tracerLesRefus(
      this.historique,
      client,
      'telechargerJustificatif',
      id,
      maintenant,
      async () => {
        const demande = await chargerDuClient(this.base, client, id);
        return justificatifATelecharger(demande.justificatifFichier, demande.justificatifNom);
      },
    );
  }
}

// Le fichier reçu doit exister, et son type RÉEL, lu sur ses premiers octets, doit être accepté
// ET correspondre au type annoncé par le navigateur. La taille (2 Mo) est déjà bornée par Multer.
// Renvoie le fichier contrôlé avec son type : la suite n'a plus besoin de le supposer présent.
function controlerFichier(fichier: FichierRecu | undefined): {
  fichier: FichierRecu;
  type: TypeJustificatif;
} {
  if (!fichier) {
    throw new ErreurApi(HttpStatus.BAD_REQUEST, [
      { code: 'VALIDATION', champ: 'fichier', message: 'Le justificatif est obligatoire.' },
    ]);
  }
  const type = detecterType(fichier.buffer);
  if (!type || TYPE_MIME[type] !== fichier.mimetype) {
    throw new ErreurApi(HttpStatus.BAD_REQUEST, [
      {
        code: 'VALIDATION',
        champ: 'fichier',
        message: 'Le justificatif doit être un fichier PDF, JPEG ou PNG.',
      },
    ]);
  }
  return { fichier, type };
}
