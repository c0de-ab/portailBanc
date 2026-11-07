import { Injectable, Logger } from '@nestjs/common';
import { avecDelai, decrireEchec } from '../banque/appel-banque';
import { BanqueService, ErreurBanque, type ResultatBancaire } from '../banque/banque.service';
import { BaseService } from '../base/base.service';
import { calculerEcheance } from '../domain/dates';
import { etatApres } from '../domain/transitions';
import { HistoriqueService } from '../historique/historique.service';
import { COLONNES_DEMANDE, type Demande, type LigneDemande, versDemande } from './demande';

// L'activation d'une demande approuvée. Ce sont des
// transitions DU SYSTÈME : conditionnées au seul statut APPROUVEE, sans version (règle 5).
// La clé est toujours act-<id> : une reprise rejoue la même clé, jamais de double activation.
@Injectable()
export class ActivationService {
  private readonly journal = new Logger(ActivationService.name);

  constructor(
    private readonly base: BaseService,
    private readonly historique: HistoriqueService,
    private readonly banque: BanqueService,
  ) {}

  // Appelle la banque et enregistre le résultat. Ne lève jamais d'erreur pour un échec de la
  // banque : la décision est prise, c'est l'activation qui reste à reprendre. Renvoie la demande
  // dans son état exact (Active, ou Approuvée avec l'activation en échec ou inconnue).
  async activer(id: string, maintenant: Date): Promise<Demande> {
    const demande = await this.relire(id);
    const transition = etatApres('confirmerActivation', demande.statut);
    if (!transition.possible) {
      // R13 : déjà activée par une autre reprise, ou plus Approuvée. Rien à faire.
      return demande;
    }
    const compte = await this.base.requete<{ numero: string }>(
      'SELECT numero FROM accounts WHERE id = $1',
      [demande.accountId],
    );

    try {
      const resultat = await avecDelai(
        this.banque.appliquer(
          `act-${id}`,
          compte.rows[0].numero,
          'ACTIVER',
          demande.plafondDemande!,
          maintenant,
        ),
      );
      await this.enregistrerSucces(demande, resultat, maintenant);
    } catch (erreur) {
      await this.enregistrerEchec(id, erreur, maintenant);
    }
    return this.relire(id);
  }

  // Approuvée -> Active, seulement si la demande est ENCORE Approuvée : deux reprises
  // simultanées ne l'appliquent qu'une fois, et un seul événement est écrit.
  private async enregistrerSucces(
    demande: Demande,
    resultat: ResultatBancaire,
    maintenant: Date,
  ): Promise<void> {
    await this.base.transaction(async (tx) => {
      const { rows } = await tx.query<LigneDemande>(
        `UPDATE requests
            SET statut = 'ACTIVE', activation_statut = 'REUSSIE', version = version + 1,
                date_activation = $2,                  -- H17 : la date enregistrée par la banque
                date_echeance = $3,                    -- H8
                derniere_erreur = NULL, updated_at = $4
          WHERE id = $1 AND statut = 'APPROUVEE'
          RETURNING ${COLONNES_DEMANDE}`,
        [
          demande.id,
          resultat.appliqueLe,
          calculerEcheance(resultat.appliqueLe, demande.dureeJours!),
          maintenant,
        ],
      );
      if (!rows[0]) {
        return; // Une autre reprise a déjà activé le plafond.
      }
      const active = versDemande(rows[0]);
      await this.historique.ecrire(
        {
          action: 'ACTIVATION_REUSSIE',
          acteurId: null,
          requestId: active.id,
          reference: active.reference,
          requestVersion: active.version,
          details: { plafondApplique: resultat.plafondApplique },
          date: maintenant,
        },
        tx,
      );
    });
  }

  // Échec ou résultat inconnu. Même condition que le succès (statut APPROUVEE) : un échec arrivé
  // en retard n'écrase jamais une activation réussie entre-temps. La version ne change pas :
  // seul le résultat d'exécution change.
  private async enregistrerEchec(id: string, erreur: unknown, maintenant: Date): Promise<void> {
    const { statut, message } = decrireEchec(erreur);
    if (!(erreur instanceof ErreurBanque)) {
      this.journal.error(erreur instanceof Error ? erreur.stack : String(erreur));
    }
    await this.base.transaction(async (tx) => {
      const { rows } = await tx.query<{ reference: string | null; version: number }>(
        `UPDATE requests SET activation_statut = $2, derniere_erreur = $3, updated_at = $4
          WHERE id = $1 AND statut = 'APPROUVEE'
          RETURNING reference, version`,
        [id, statut, message, maintenant],
      );
      if (!rows[0]) {
        return;
      }
      await this.historique.ecrire(
        {
          action: statut === 'ECHEC' ? 'ACTIVATION_ECHEC' : 'ACTIVATION_INCONNUE',
          acteurId: null,
          requestId: id,
          reference: rows[0].reference,
          requestVersion: rows[0].version,
          details: { erreur: message },
          date: maintenant,
        },
        tx,
      );
    });
  }

  private async relire(id: string): Promise<Demande> {
    const { rows } = await this.base.requete<LigneDemande>(
      `SELECT ${COLONNES_DEMANDE} FROM requests WHERE id = $1`,
      [id],
    );
    return versDemande(rows[0]);
  }
}
