import { Injectable } from '@nestjs/common';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import { BaseService } from '../base/base.service';
import type { ErreurRegle } from '../domain/erreurs';
import { type Action, type StatutDemande } from '../domain/transitions';
import { HistoriqueService } from '../historique/historique.service';
import {
  avertissementsDe,
  chargerDuClient,
  verifierTransition,
  verifierVersion,
} from './acces-client';
import {
  COLONNES_DEMANDE,
  type Demande,
  type LigneDemande,
  lireRevisions,
  type Revision,
  versDemande,
} from './demande';
import { refuser, versionPerimee } from './refus';
import { tracerLesRefus } from './tracer-refus';

// Les statuts « en cours » de R6, ceux de l'index uq_demande_en_cours.
const STATUTS_EN_COURS: StatutDemande[] = [
  'SOUMISE',
  'COMPLEMENT_DEMANDE',
  'ATTENTE_SUPERVISEUR',
  'APPROUVEE',
  'ACTIVE',
];

export type Compte = {
  id: string;
  numero: string;
  plafondInitial: number;
  // Le plafond réellement appliqué par la banque (H21).
  plafondCourant: number;
  plafondTemporaireActif: boolean;
  // La demande en cours du compte, s'il y en a une (R6).
  demandeEnCours: { id: string; reference: string | null; statut: StatutDemande } | null;
};

export type DemandeEtAvertissements = { demande: Demande; avertissements: ErreurRegle[] };

export type DetailDemande = {
  demande: Demande;
  revisions: Revision[];
  // H19 : le client voit les motifs de complément, d'approbation et de rejet, jamais ceux
  // des recommandations, qui restent internes à la banque.
  decisions: { type: string; motif: string; revisionNo: number; decideeLe: Date }[];
};

export type ContenuModifie = {
  plafondDemande?: number | null;
  dureeJours?: number | null;
  motif?: string | null;
};

// Le parcours du client : brouillon, modification, abandon, annulation, et ce que l'agent
// prépare. La soumission confirmée (R7) est dans soumission.service.ts, le justificatif dans
// justificatifs-client.service.ts ; les étapes communes sont dans acces-client.ts.
// Chaque action suit le même ordre : charger le dossier avec le
// filtre de périmètre (404 sinon), demander à la table des transitions si l'action est possible,
// vérifier les règles du domaine, puis une mise à jour conditionnelle sur la version et le
// statut, dans une transaction avec l'événement.
@Injectable()
export class DemandesClientService {
  constructor(
    private readonly base: BaseService,
    private readonly historique: HistoriqueService,
  ) {}

  async comptes(client: UtilisateurSession): Promise<Compte[]> {
    const { rows } = await this.base.requete<{
      id: string;
      numero: string;
      plafond_initial: number;
      plafond_courant: number;
      demande_id: string | null;
      demande_reference: string | null;
      demande_statut: StatutDemande | null;
    }>(
      `SELECT a.id, a.numero, a.plafond_initial, b.plafond_courant,
              r.id AS demande_id, r.reference AS demande_reference, r.statut AS demande_statut
         FROM accounts a
         JOIN bank_limits b ON b.numero = a.numero
         LEFT JOIN requests r ON r.account_id = a.id AND r.statut = ANY($2::statut_demande[])
        WHERE a.client_id = $1
        ORDER BY a.numero`,
      [client.clientId, STATUTS_EN_COURS],
    );
    return rows.map((l) => ({
      id: l.id,
      numero: l.numero,
      plafondInitial: l.plafond_initial,
      plafondCourant: l.plafond_courant,
      plafondTemporaireActif: l.plafond_courant > l.plafond_initial,
      demandeEnCours: l.demande_id
        ? { id: l.demande_id, reference: l.demande_reference, statut: l.demande_statut! }
        : null,
    }));
  }

  // Renvoie le brouillon du compte, ou le crée s'il n'existe pas (H1, H20) : un double clic
  // ou un rechargement ne produit jamais deux brouillons, ni une erreur.
  obtenirBrouillon(
    client: UtilisateurSession,
    compteId: string,
    maintenant: Date,
  ): Promise<DemandeEtAvertissements & { cree: boolean }> {
    return this.tracerLesRefus(client, 'obtenirBrouillon', compteId, maintenant, async () => {
      const compte = await this.base.requete(
        'SELECT 1 FROM accounts WHERE id = $1 AND client_id = $2',
        [compteId, client.clientId],
      );
      if (compte.rowCount !== 1) {
        throw refuser([{ code: 'R14', message: 'Compte introuvable.' }]);
      }

      const resultat = await this.base.transaction(async (tx) => {
        // ON CONFLICT sur l'index partiel : si un brouillon existe déjà, rien n'est inséré.
        const insertion = await tx.query<LigneDemande>(
          `INSERT INTO requests (account_id, client_id, created_at, updated_at)
           VALUES ($1, $2, $3, $3)
           ON CONFLICT (account_id) WHERE statut = 'BROUILLON' DO NOTHING
           RETURNING ${COLONNES_DEMANDE}`,
          [compteId, client.clientId, maintenant],
        );
        if (insertion.rows[0]) {
          const demande = versDemande(insertion.rows[0]);
          await this.historique.ecrire(
            {
              action: 'BROUILLON_CREE',
              acteurId: client.id,
              requestId: demande.id,
              requestVersion: demande.version,
              date: maintenant,
            },
            tx,
          );
          return { demande, cree: true };
        }
        const existant = await tx.query<LigneDemande>(
          `SELECT ${COLONNES_DEMANDE} FROM requests WHERE account_id = $1 AND statut = 'BROUILLON'`,
          [compteId],
        );
        return { demande: versDemande(existant.rows[0]), cree: false };
      });

      return { ...resultat, avertissements: await this.avertissements(resultat.demande) };
    });
  }

  // R5 : le dossier du client est-il complet ? Toujours relu en base, jamais dans la session.
  async dossierComplet(client: UtilisateurSession): Promise<boolean> {
    const { rows } = await this.base.requete<{ dossier_complet: boolean }>(
      'SELECT dossier_complet FROM clients WHERE id = $1',
      [client.clientId],
    );
    return rows[0]?.dossier_complet ?? false;
  }

  // H20 : la demande à préparer pour ce compte, celle en Complément demandé s'il y en a une,
  // sinon le brouillon, créé s'il n'existe pas. Dans le périmètre du client seulement.
  async demandeAPreparer(
    client: UtilisateurSession,
    compteId: string,
    maintenant: Date,
  ): Promise<Demande> {
    const { rows } = await this.base.requete<LigneDemande>(
      `SELECT ${COLONNES_DEMANDE} FROM requests
        WHERE account_id = $1 AND client_id = $2 AND statut = 'COMPLEMENT_DEMANDE'`,
      [compteId, client.clientId],
    );
    if (rows[0]) {
      return versDemande(rows[0]);
    }
    return (await this.obtenirBrouillon(client, compteId, maintenant)).demande;
  }

  // Avant la carte de confirmation (R7) : la demande doit pouvoir être soumise (table des
  // transitions) et respecter toutes les règles, sinon la soumission serait refusée de toute
  // façon. Les mêmes vérifications que `soumettre`, sans rien modifier.
  pretePourConfirmation(
    client: UtilisateurSession,
    id: string,
    maintenant: Date,
  ): Promise<Demande> {
    return this.tracerLesRefus(client, 'preparerConfirmation', id, maintenant, async () => {
      const demande = await chargerDuClient(this.base, client, id);
      verifierTransition('soumettre', demande.statut);
      const avertissements = await this.avertissements(demande);
      if (avertissements.length > 0) {
        throw refuser(avertissements);
      }
      return demande;
    });
  }

  async lister(client: UtilisateurSession): Promise<Demande[]> {
    const { rows } = await this.base.requete<LigneDemande>(
      `SELECT ${COLONNES_DEMANDE} FROM requests WHERE client_id = $1 ORDER BY created_at DESC`,
      [client.clientId],
    );
    return rows.map(versDemande);
  }

  detail(client: UtilisateurSession, id: string, maintenant: Date): Promise<DetailDemande> {
    return this.tracerLesRefus(client, 'consulter', id, maintenant, async () => {
      const demande = await chargerDuClient(this.base, client, id);
      const decisions = await this.base.requete<{
        type: string;
        motif: string;
        revision_no: number;
        created_at: Date;
      }>(
        `SELECT type, motif, revision_no, created_at FROM decisions
          WHERE request_id = $1 AND type IN ('DEMANDE_COMPLEMENT', 'APPROBATION', 'REJET')
          ORDER BY created_at`,
        [id],
      );
      return {
        demande,
        revisions: await lireRevisions(this.base, id),
        decisions: decisions.rows.map((d) => ({
          type: d.type,
          motif: d.motif,
          revisionNo: d.revision_no,
          decideeLe: d.created_at,
        })),
      };
    });
  }

  // Modifie le contenu en Brouillon ou en Complément demandé (H7, H20). Les champs absents
  // gardent leur valeur. Renvoie les avertissements : ils n'empêchent pas l'enregistrement (H23).
  modifier(
    client: UtilisateurSession,
    id: string,
    version: number,
    contenu: ContenuModifie,
    maintenant: Date,
  ): Promise<DemandeEtAvertissements> {
    return this.tracerLesRefus(client, 'modifier', id, maintenant, async () => {
      const demande = await chargerDuClient(this.base, client, id);
      verifierVersion(demande, version);
      verifierTransition('modifier', demande.statut);

      const nouveau = {
        plafondDemande:
          contenu.plafondDemande !== undefined ? contenu.plafondDemande : demande.plafondDemande,
        dureeJours: contenu.dureeJours !== undefined ? contenu.dureeJours : demande.dureeJours,
        motif: contenu.motif !== undefined ? contenu.motif : demande.motif,
      };

      const modifiee = await this.base.transaction(async (tx) => {
        const { rows } = await tx.query<LigneDemande>(
          `UPDATE requests
              SET plafond_demande = $5, duree_jours = $6, motif = $7,
                  version = version + 1, updated_at = $8
            WHERE id = $1 AND client_id = $2 AND version = $3 AND statut = $4
            RETURNING ${COLONNES_DEMANDE}`,
          [
            id,
            client.clientId,
            version,
            demande.statut,
            nouveau.plafondDemande,
            nouveau.dureeJours,
            nouveau.motif,
            maintenant,
          ],
        );
        if (!rows[0]) {
          throw versionPerimee();
        }
        const resultat = versDemande(rows[0]);
        await this.historique.ecrire(
          {
            action: 'MODIFICATION',
            acteurId: client.id,
            requestId: id,
            reference: resultat.reference,
            requestVersion: resultat.version,
            date: maintenant,
          },
          tx,
        );
        return resultat;
      });

      return { demande: modifiee, avertissements: await this.avertissements(modifiee) };
    });
  }

  // H10 : un brouillon abandonné n'est jamais supprimé.
  abandonner(
    client: UtilisateurSession,
    id: string,
    version: number,
    maintenant: Date,
  ): Promise<Demande> {
    return this.changerStatut(client, id, 'abandonner', 'ABANDON', version, maintenant);
  }

  // R12 : annulation possible jusqu'à la première décision d'approbation ou de rejet.
  annuler(
    client: UtilisateurSession,
    id: string,
    version: number,
    maintenant: Date,
  ): Promise<Demande> {
    return this.changerStatut(client, id, 'annuler', 'ANNULATION', version, maintenant);
  }

  // ---------------------------------------------------------------------------------------

  // Une transition sans changement de contenu : seul le statut change.
  private changerStatut(
    client: UtilisateurSession,
    id: string,
    action: Action,
    evenement: string,
    version: number,
    maintenant: Date,
  ): Promise<Demande> {
    return this.tracerLesRefus(client, action, id, maintenant, async () => {
      const demande = await chargerDuClient(this.base, client, id);
      verifierVersion(demande, version);
      const vers = verifierTransition(action, demande.statut);

      return this.base.transaction(async (tx) => {
        const { rows } = await tx.query<LigneDemande>(
          `UPDATE requests SET statut = $5, version = version + 1, updated_at = $6
            WHERE id = $1 AND client_id = $2 AND version = $3 AND statut = $4
            RETURNING ${COLONNES_DEMANDE}`,
          [id, client.clientId, version, demande.statut, vers, maintenant],
        );
        if (!rows[0]) {
          throw versionPerimee();
        }
        const resultat = versDemande(rows[0]);
        await this.historique.ecrire(
          {
            action: evenement,
            acteurId: client.id,
            requestId: id,
            reference: resultat.reference,
            requestVersion: resultat.version,
            date: maintenant,
          },
          tx,
        );
        return resultat;
      });
    });
  }

  // H23 : les mêmes règles que la soumission, en avertissements.
  async avertissements(demande: Demande): Promise<ErreurRegle[]> {
    return avertissementsDe(this.base, demande);
  }

  // Règle 11 : voir tracer-refus.ts, commun au client et au personnel.
  private tracerLesRefus<T>(
    acteur: UtilisateurSession,
    action: string,
    cible: string,
    maintenant: Date,
    travail: () => Promise<T>,
  ): Promise<T> {
    return tracerLesRefus(this.historique, acteur, action, cible, maintenant, travail);
  }
}
