import { Injectable, Logger } from '@nestjs/common';
import { avecDelai, decrireEchec } from '../banque/appel-banque';
import { BanqueService, ErreurBanque } from '../banque/banque.service';
import { BaseService } from '../base/base.service';
import { etatApres } from '../domain/transitions';
import { HistoriqueService } from '../historique/historique.service';
import { COLONNES_DEMANDE, type Demande, type LigneDemande, versDemande } from './demande';

export type BilanExpiration = { expirees: number; enEchec: number };

// L'expiration des plafonds temporaires (docs/etats-transitions.md, § 3, H6, H22).
// Des transitions DU SYSTÈME : conditionnées au seul statut ACTIVE, sans version (règle 5).
// La clé est toujours desact-<id> : une reprise rejoue la même clé, jamais de double désactivation.
@Injectable()
export class ExpirationService {
  private readonly journal = new Logger(ExpirationService.name);

  constructor(
    private readonly base: BaseService,
    private readonly historique: HistoriqueService,
    private readonly banque: BanqueService,
  ) {}

  // Règle 9 : deux dates distinctes. `dateSimulee` sert UNIQUEMENT à sélectionner les échéances ;
  // `maintenant`, l'heure réelle, date les événements (H22).
  // Les désactivations échouées lors d'un passage précédent sont reprises : la demande est
  // toujours Active, et son échéance toujours passée.
  async expirer(dateSimulee: Date, maintenant: Date): Promise<BilanExpiration> {
    const { rows } = await this.base.requete<LigneDemande>(
      `SELECT ${COLONNES_DEMANDE} FROM requests
        WHERE statut = 'ACTIVE' AND date_echeance <= $1
        ORDER BY date_echeance`,
      [dateSimulee],
    );

    const bilan: BilanExpiration = { expirees: 0, enEchec: 0 };
    // Une demande après l'autre : l'échec de l'une n'arrête pas les autres.
    for (const demande of rows.map(versDemande)) {
      const expiree = await this.desactiver(demande, dateSimulee, maintenant);
      bilan[expiree ? 'expirees' : 'enEchec']++;
    }
    return bilan;
  }

  // Renvoie true si la demande est Expirée à l'issue de l'appel.
  private async desactiver(
    demande: Demande,
    dateSimulee: Date,
    maintenant: Date,
  ): Promise<boolean> {
    const transition = etatApres('confirmerDesactivation', demande.statut);
    if (!transition.possible) {
      return false;
    }
    const compte = await this.base.requete<{ numero: string; plafond_initial: number }>(
      'SELECT numero, plafond_initial FROM accounts WHERE id = $1',
      [demande.accountId],
    );
    const { numero, plafond_initial: plafondInitial } = compte.rows[0];

    // Couplage : désactivation En attente, puis appel à la banque.
    await this.base.requete(
      `UPDATE requests SET desactivation_statut = 'EN_ATTENTE', updated_at = $2
        WHERE id = $1 AND statut = 'ACTIVE'`,
      [demande.id, maintenant],
    );

    try {
      await avecDelai(
        this.banque.appliquer(
          `desact-${demande.id}`,
          numero,
          'DESACTIVER',
          plafondInitial,
          maintenant,
        ),
      );
    } catch (erreur) {
      await this.enregistrerEchec(demande, erreur, dateSimulee, maintenant);
      return false;
    }

    // H6 : Expirée seulement quand la banque a confirmé le retour au plafond initial.
    return this.base.transaction(async (tx) => {
      const { rows } = await tx.query<LigneDemande>(
        `UPDATE requests
            SET statut = 'EXPIREE', desactivation_statut = 'REUSSIE', version = version + 1,
                derniere_erreur = NULL, updated_at = $2
          WHERE id = $1 AND statut = 'ACTIVE'
          RETURNING ${COLONNES_DEMANDE}`,
        [demande.id, maintenant],
      );
      if (!rows[0]) {
        return false;
      }
      const expiree = versDemande(rows[0]);
      await this.historique.ecrire(
        {
          action: 'EXPIRATION',
          acteurId: null,
          requestId: expiree.id,
          reference: expiree.reference,
          requestVersion: expiree.version,
          // H22 : l'événement est daté de l'heure réelle ; la date simulée est ici.
          details: { dateSimulee: dateSimulee.toISOString(), plafondRetabli: plafondInitial },
          date: maintenant,
        },
        tx,
      );
      return true;
    });
  }

  // La demande reste Active ; le passage suivant reprendra avec la même clé. Même condition que
  // le succès (statut ACTIVE) : un échec tardif n'écrase jamais une expiration réussie.
  private async enregistrerEchec(
    demande: Demande,
    erreur: unknown,
    dateSimulee: Date,
    maintenant: Date,
  ): Promise<void> {
    const { statut, message } = decrireEchec(erreur);
    if (!(erreur instanceof ErreurBanque)) {
      this.journal.error(erreur instanceof Error ? erreur.stack : String(erreur));
    }
    await this.base.transaction(async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE requests SET desactivation_statut = $2, derniere_erreur = $3, updated_at = $4
          WHERE id = $1 AND statut = 'ACTIVE'`,
        [demande.id, statut, message, maintenant],
      );
      if (rowCount !== 1) {
        return;
      }
      await this.historique.ecrire(
        {
          action: statut === 'ECHEC' ? 'DESACTIVATION_ECHEC' : 'DESACTIVATION_INCONNUE',
          acteurId: null,
          requestId: demande.id,
          reference: demande.reference,
          requestVersion: demande.version,
          details: { dateSimulee: dateSimulee.toISOString(), erreur: message },
          date: maintenant,
        },
        tx,
      );
    });
  }
}
