import { Injectable } from '@nestjs/common';
import { DatabaseError, type PoolClient } from 'pg';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import { BaseService } from '../base/base.service';
import { formaterReference } from '../domain/dates';
import { verifierRegles } from '../domain/regles';
import type { ErreurApi } from '../http/erreur-api';
import { HistoriqueService } from '../historique/historique.service';
import {
  chargerDuClient,
  contenuDe,
  type ContexteCompte,
  contexteDuCompte,
  verifierTransition,
} from './acces-client';
import { COLONNES_DEMANDE, type Demande, type LigneDemande, versDemande } from './demande';
import { refuser } from './refus';
import { tracerLesRefus } from './tracer-refus';

export type Confirmation = { version: number; plafondDemande: number; dureeJours: number };

// La soumission confirmée par le client (R7), la seule porte vers « Soumise » : la route du
// formulaire et le clic sur la carte de l'assistant arrivent ici. L'agent ne soumet jamais.
@Injectable()
export class SoumissionService {
  constructor(
    private readonly base: BaseService,
    private readonly historique: HistoriqueService,
  ) {}

  // Acceptée seulement si la demande a encore la version, le montant et la durée que le client
  // a confirmés, et si elle respecte toutes les règles (R1 à R5).
  soumettre(
    client: UtilisateurSession,
    id: string,
    confirmation: Confirmation,
    maintenant: Date,
  ): Promise<Demande> {
    return tracerLesRefus(this.historique, client, 'soumettre', id, maintenant, async () => {
      const demande = await chargerDuClient(this.base, client, id);
      verifierTransition('soumettre', demande.statut);
      if (
        demande.version !== confirmation.version ||
        demande.plafondDemande !== confirmation.plafondDemande ||
        demande.dureeJours !== confirmation.dureeJours
      ) {
        throw confirmationARenouveler();
      }

      // R5 et le plafond initial sont relus en base, jamais pris dans la session.
      const contexte = await contexteDuCompte(this.base, demande.accountId);
      const erreurs = verifierRegles(contenuDe(demande), contexte);
      if (erreurs.length > 0) {
        throw refuser(erreurs);
      }

      return this.enregistrer(client, demande, confirmation, contexte, maintenant);
    });
  }

  // Une seule transaction pour la transition, la révision et l'événement (règle 6). Le UPDATE
  // reprend tout ce que le client a confirmé (R7) : la version, le montant et la durée affichés.
  private async enregistrer(
    client: UtilisateurSession,
    demande: Demande,
    confirmation: Confirmation,
    contexte: ContexteCompte,
    maintenant: Date,
  ): Promise<Demande> {
    const { id } = demande;
    try {
      return await this.base.transaction(async (tx) => {
        // R5 relu DANS la transaction, avec un verrou partagé sur la ligne du client : son dossier
        // ne peut pas devenir incomplet entre la vérification et la soumission. Les règles sont
        // revérifiées avec cette valeur, par le domaine, comme avant la transaction.
        const dossier = await tx.query<{ dossier_complet: boolean }>(
          'SELECT dossier_complet FROM clients WHERE id = $1 FOR SHARE',
          [client.clientId],
        );
        const erreurs = verifierRegles(contenuDe(demande), {
          ...contexte,
          dossierComplet: dossier.rows[0]?.dossier_complet ?? false,
        });
        if (erreurs.length > 0) {
          throw refuser(erreurs);
        }

        // H13 : la référence est tirée à la PREMIÈRE soumission seulement.
        const reference = demande.reference ?? (await nouvelleReference(tx, maintenant));
        const { rows } = await tx.query<LigneDemande>(
          `UPDATE requests
                SET statut = 'SOUMISE', version = version + 1,
                    revision_courante = revision_courante + 1,
                    reference = COALESCE(reference, $6),
                    submitted_at = COALESCE(submitted_at, $7),
                    advisor_id = COALESCE(advisor_id, $8),   -- H9 : fixés à la première
                    team_id = COALESCE(team_id, $9),         -- soumission, puis inchangés
                    updated_at = $7
              WHERE id = $1 AND client_id = $2
                AND statut IN ('BROUILLON', 'COMPLEMENT_DEMANDE')
                AND version = $3                             -- version transmise, non affichée
                AND plafond_demande = $4                     -- montant affiché
                AND duree_jours = $5                         -- durée affichée
              RETURNING ${COLONNES_DEMANDE}`,
          [
            id,
            client.clientId,
            confirmation.version,
            confirmation.plafondDemande,
            confirmation.dureeJours,
            reference,
            maintenant,
            contexte.conseillerId,
            contexte.equipeId,
          ],
        );
        if (!rows[0]) {
          throw confirmationARenouveler();
        }
        const soumise = versDemande(rows[0]);

        await tx.query(
          `INSERT INTO request_revisions
               (request_id, revision_no, plafond_demande, duree_jours, motif,
                justificatif_fichier, justificatif_nom, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            soumise.revisionCourante,
            soumise.plafondDemande,
            soumise.dureeJours,
            soumise.motif,
            soumise.justificatifFichier,
            soumise.justificatifNom,
            client.id,
            maintenant,
          ],
        );
        await this.historique.ecrire(
          {
            action: 'SOUMISSION',
            acteurId: client.id,
            requestId: id,
            reference: soumise.reference,
            requestVersion: soumise.version,
            details: { revision: soumise.revisionCourante },
            date: maintenant,
          },
          tx,
        );
        return soumise;
      });
    } catch (erreur) {
      // R6 : l'index partiel refuse une seconde demande en cours sur le compte,
      // même si deux soumissions arrivent en même temps.
      if (erreur instanceof DatabaseError && erreur.constraint === 'uq_demande_en_cours') {
        throw refuser([
          {
            code: 'R6',
            message: 'Ce compte a déjà une demande en cours ou un plafond temporaire actif.',
          },
        ]);
      }
      throw erreur;
    }
  }
}

// R7 : ce que le client a confirmé ne correspond plus à la demande.
function confirmationARenouveler(): ErreurApi {
  return refuser([
    {
      code: 'R7',
      message:
        'La demande a changé depuis votre confirmation : vérifiez les informations et confirmez de nouveau.',
    },
  ]);
}

// H13 : DEM-<année>-<numéro de la séquence>, mis en forme par le domaine.
async function nouvelleReference(tx: PoolClient, maintenant: Date): Promise<string> {
  const { rows } = await tx.query<{ numero: string }>(
    "SELECT nextval('demande_reference_seq') AS numero",
  );
  return formaterReference(maintenant, Number(rows[0].numero));
}
