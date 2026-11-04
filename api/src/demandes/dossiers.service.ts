import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import type { Role, UtilisateurSession } from '../auth/utilisateur-session';
import { BaseService } from '../base/base.service';
import { type TypeDecision, verifierDecision } from '../domain/regles';
import { type Action, etatApres } from '../domain/transitions';
import { ErreurApi } from '../http/erreur-api';
import { HistoriqueService } from '../historique/historique.service';
import {
  justificatifATelecharger,
  type JustificatifATelecharger,
} from '../justificatifs/justificatif';
import { ActivationService } from './activation.service';
import { COLONNES_DEMANDE, type Demande, type LigneDemande, versDemande } from './demande';
import { introuvable, refuser, versionPerimee } from './refus';
import { tracerLesRefus } from './tracer-refus';

// Les décisions du personnel et l'action de la table des transitions qui leur correspond.
export type ActionDecision = Extract<
  Action,
  'demanderComplement' | 'approuver' | 'rejeter' | 'recommander'
>;
export type Avis = 'FAVORABLE' | 'DEFAVORABLE';

const TYPE_DU_DOMAINE: Record<ActionDecision, TypeDecision> = {
  demanderComplement: 'DEMANDE_COMPLEMENT',
  approuver: 'APPROBATION',
  rejeter: 'REJET',
  recommander: 'RECOMMANDATION',
};

export type DetailDossier = {
  demande: Demande;
  client: { nom: string; dossierComplet: boolean };
  compte: { numero: string; plafondInitial: number };
  revisions: {
    revisionNo: number;
    plafondDemande: number;
    dureeJours: number;
    motif: string;
    justificatifNom: string | null;
    soumiseLe: Date;
  }[];
  // Le personnel voit TOUTES les décisions, recommandations comprises.
  decisions: {
    type: string;
    acteur: string;
    role: Role;
    motif: string;
    requestVersion: number;
    revisionNo: number;
    decideeLe: Date;
  }[];
  historique: {
    action: string;
    acteur: string | null;
    viaAgent: boolean;
    requestVersion: number | null;
    motif: string | null;
    date: Date;
  }[];
};

// Le traitement des dossiers par le conseiller et le superviseur (docs/etats-transitions.md, § 4).
@Injectable()
export class DossiersService {
  constructor(
    private readonly base: BaseService,
    private readonly historique: HistoriqueService,
    private readonly activation: ActivationService,
  ) {}

  async lister(agent: UtilisateurSession): Promise<Demande[]> {
    const { rows } = await this.base.requete<LigneDemande>(
      `SELECT ${COLONNES_DEMANDE} FROM requests
        WHERE ${FILTRE_PERIMETRE}
        ORDER BY submitted_at`,
      valeursDuPerimetre(agent),
    );
    return rows.map(versDemande);
  }

  detail(agent: UtilisateurSession, id: string, maintenant: Date): Promise<DetailDossier> {
    return tracerLesRefus(this.historique, agent, 'consulterDossier', id, maintenant, async () => {
      const demande = await this.charger(agent, id);

      const identite = await this.base.requete<{
        nom: string;
        dossier_complet: boolean;
        numero: string;
        plafond_initial: number;
      }>(
        `SELECT u.display_name AS nom, c.dossier_complet, a.numero, a.plafond_initial
           FROM accounts a
           JOIN clients c ON c.id = a.client_id
           JOIN users u ON u.id = c.user_id
          WHERE a.id = $1`,
        [demande.accountId],
      );
      const revisions = await this.base.requete<{
        revision_no: number;
        plafond_demande: number;
        duree_jours: number;
        motif: string;
        justificatif_nom: string | null;
        created_at: Date;
      }>(
        `SELECT revision_no, plafond_demande, duree_jours, motif, justificatif_nom, created_at
           FROM request_revisions WHERE request_id = $1 ORDER BY revision_no`,
        [id],
      );
      const decisions = await this.base.requete<{
        type: string;
        acteur: string;
        actor_role: Role;
        motif: string;
        request_version: number;
        revision_no: number;
        created_at: Date;
      }>(
        `SELECT d.type, u.display_name AS acteur, d.actor_role, d.motif, d.request_version,
                d.revision_no, d.created_at
           FROM decisions d JOIN users u ON u.id = d.actor_id
          WHERE d.request_id = $1 ORDER BY d.created_at`,
        [id],
      );
      const evenements = await this.base.requete<{
        action: string;
        acteur: string | null;
        via_agent: boolean;
        request_version: number | null;
        motif: string | null;
        created_at: Date;
      }>(
        `SELECT e.action, u.display_name AS acteur, e.via_agent, e.request_version, e.motif,
                e.created_at
           FROM events e LEFT JOIN users u ON u.id = e.actor_id
          WHERE e.request_id = $1 ORDER BY e.id`,
        [id],
      );

      const ligne = identite.rows[0];
      return {
        demande,
        client: { nom: ligne.nom, dossierComplet: ligne.dossier_complet },
        compte: { numero: ligne.numero, plafondInitial: ligne.plafond_initial },
        revisions: revisions.rows.map((r) => ({
          revisionNo: r.revision_no,
          plafondDemande: r.plafond_demande,
          dureeJours: r.duree_jours,
          motif: r.motif,
          justificatifNom: r.justificatif_nom,
          soumiseLe: r.created_at,
        })),
        decisions: decisions.rows.map((d) => ({
          type: d.type,
          acteur: d.acteur,
          role: d.actor_role,
          motif: d.motif,
          requestVersion: d.request_version,
          revisionNo: d.revision_no,
          decideeLe: d.created_at,
        })),
        historique: evenements.rows.map((e) => ({
          action: e.action,
          acteur: e.acteur,
          viaAgent: e.via_agent,
          requestVersion: e.request_version,
          motif: e.motif,
          date: e.created_at,
        })),
      };
    });
  }

  lireJustificatif(
    agent: UtilisateurSession,
    id: string,
    maintenant: Date,
  ): Promise<JustificatifATelecharger> {
    return tracerLesRefus(
      this.historique,
      agent,
      'telechargerJustificatif',
      id,
      maintenant,
      async () => {
        const demande = await this.charger(agent, id);
        return justificatifATelecharger(demande.justificatifFichier, demande.justificatifNom);
      },
    );
  }

  // Une décision humaine, toujours motivée (R10). Dans l'ordre : périmètre (404), version (409),
  // table des transitions (409), rôle déduit de l'état (403 ROLE), règles du domaine
  // (R8, R9 : 403 ; R10 : 422), puis une seule transaction pour la transition, la décision et
  // l'événement.
  decider(
    agent: UtilisateurSession,
    id: string,
    action: ActionDecision,
    version: number,
    motif: string,
    maintenant: Date,
    avis: Avis = 'FAVORABLE',
  ): Promise<Demande> {
    return tracerLesRefus(this.historique, agent, action, id, maintenant, async () => {
      const demande = await this.charger(agent, id);
      if (demande.version !== version) {
        throw versionPerimee();
      }

      const transition = etatApres(action, demande.statut);
      if (!transition.possible) {
        throw refuser([transition.erreur]);
      }

      // H18 : le rôle de la décision est déduit de l'état, jamais choisi par l'utilisateur.
      // Il faut l'avoir, ET être dans le périmètre de ce rôle pour ce dossier : le conseiller
      // du dossier sur une demande soumise, un superviseur de son équipe sur une demande transmise.
      const role = transition.acteurs[0] as 'CONSEILLER' | 'SUPERVISEUR';
      const dansSonPerimetre =
        role === 'CONSEILLER'
          ? demande.advisorId === agent.id
          : demande.teamId === agent.teamId && demande.recommenderId !== null;
      if (!agent.roles.includes(role) || !dansSonPerimetre) {
        throw new ErreurApi(HttpStatus.FORBIDDEN, [
          {
            code: 'ROLE',
            message:
              role === 'CONSEILLER'
                ? 'Seul le conseiller du dossier peut décider sur une demande soumise.'
                : "Seul un superviseur de l'équipe peut décider sur une demande transmise.",
          },
        ]);
      }

      const erreurs = verifierDecision(
        { type: TYPE_DU_DOMAINE[action], role, acteurId: agent.id, motif },
        // H4 : le montant de la révision en cours ; hors brouillon et complément, la copie de
        // travail est exactement la révision soumise.
        { plafondDemande: demande.plafondDemande!, recommenderId: demande.recommenderId },
      );
      if (erreurs.length > 0) {
        throw refuser(erreurs);
      }

      const typeEnBase =
        action === 'recommander' ? `RECOMMANDATION_${avis}` : TYPE_DU_DOMAINE[action];
      const recommenderId = action === 'recommander' ? agent.id : demande.recommenderId;
      // Couplage (docs/etats-transitions.md, § 3) : l'approbation met l'activation En attente,
      // dans la même transaction ; l'appel à la banque est fait juste après le COMMIT.
      const activationStatut = action === 'approuver' ? 'EN_ATTENTE' : demande.activationStatut;

      let decidee: Demande;
      try {
        decidee = await this.base.transaction(async (tx) => {
          const { rows } = await tx.query<LigneDemande>(
            `UPDATE requests
                SET statut = $4, version = version + 1, recommender_id = $5,
                    activation_statut = $6, updated_at = $7
              WHERE id = $1 AND version = $2 AND statut = $3
              RETURNING ${COLONNES_DEMANDE}`,
            [
              id,
              version,
              demande.statut,
              transition.vers,
              recommenderId,
              activationStatut,
              maintenant,
            ],
          );
          if (!rows[0]) {
            throw versionPerimee();
          }
          const resultat = versDemande(rows[0]);

          await tx.query(
            `INSERT INTO decisions
               (request_id, type, actor_id, actor_role, motif, request_version, revision_no, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, typeEnBase, agent.id, role, motif, version, demande.revisionCourante, maintenant],
          );
          await this.historique.ecrire(
            {
              action: typeEnBase,
              acteurId: agent.id,
              requestId: id,
              reference: resultat.reference,
              requestVersion: resultat.version,
              motif,
              date: maintenant,
            },
            tx,
          );
          return resultat;
        });
      } catch (erreur) {
        // Une seule décision par version : la seconde de deux décisions simultanées.
        if (
          erreur instanceof DatabaseError &&
          erreur.constraint === 'decisions_request_id_request_version_key'
        ) {
          throw versionPerimee();
        }
        throw erreur;
      }

      // Après une approbation : l'activation dans la banque simulée. La réponse indique son
      // résultat (Active, ou Approuvée avec l'activation en échec ou inconnue).
      return action === 'approuver' ? this.activation.activer(id, maintenant) : decidee;
    });
  }

  // « Relancer » (H12, H15) : une action utilisateur, filtrée par le périmètre et tracée, mais
  // conditionnée au SEUL statut Approuvée, sans version : elle ne prend aucune décision, elle
  // rejoue l'activation avec la même clé. Possible depuis Échec, Résultat inconnu ou En attente.
  relancer(agent: UtilisateurSession, id: string, maintenant: Date): Promise<Demande> {
    return tracerLesRefus(this.historique, agent, 'relancer', id, maintenant, async () => {
      const demande = await this.charger(agent, id);
      const transition = etatApres('relancer', demande.statut);
      if (!transition.possible) {
        throw refuser([transition.erreur]);
      }
      // H12 : le conseiller du dossier, ou un superviseur de l'équipe si le dossier lui a été transmis.
      const conseillerDuDossier =
        agent.roles.includes('CONSEILLER') && demande.advisorId === agent.id;
      const superviseurDeLEquipe =
        agent.roles.includes('SUPERVISEUR') &&
        demande.teamId === agent.teamId &&
        demande.recommenderId !== null;
      if (!conseillerDuDossier && !superviseurDeLEquipe) {
        throw new ErreurApi(HttpStatus.FORBIDDEN, [
          {
            code: 'ROLE',
            message:
              "Seuls le conseiller du dossier ou un superviseur de l'équipe peuvent relancer.",
          },
        ]);
      }

      await this.base.transaction(async (tx) => {
        const { rowCount } = await tx.query(
          `UPDATE requests SET activation_statut = 'EN_ATTENTE', derniere_erreur = NULL,
                  updated_at = $2
            WHERE id = $1 AND statut = 'APPROUVEE'`,
          [id, maintenant],
        );
        // Une autre relance a déjà activé la demande : rien à tracer, l'état final est renvoyé.
        if (rowCount === 1) {
          await this.historique.ecrire(
            {
              action: 'RELANCE',
              acteurId: agent.id,
              requestId: id,
              reference: demande.reference,
              requestVersion: demande.version,
              date: maintenant,
            },
            tx,
          );
        }
      });
      return this.activation.activer(id, maintenant);
    });
  }

  // Règle 4 : le filtre de périmètre est DANS la requête. Hors périmètre ou inexistant : 404.
  private async charger(agent: UtilisateurSession, id: string): Promise<Demande> {
    const { rows } = await this.base.requete<LigneDemande>(
      `SELECT ${COLONNES_DEMANDE} FROM requests WHERE id = $5 AND ${FILTRE_PERIMETRE}`,
      [...valeursDuPerimetre(agent), id],
    );
    if (!rows[0]) {
      throw introuvable();
    }
    return versDemande(rows[0]);
  }
}

// R14 (docs/modele-donnees.md, § 5) : le portefeuille du conseiller, ou les dossiers TRANSMIS à
// l'équipe du superviseur, et l'union des deux pour un double rôle (H18). Un texte fixe : les
// valeurs passent par $1 à $4, jamais par concaténation.
const FILTRE_PERIMETRE = `(
  ($1::boolean AND advisor_id = $2)
  OR ($3::boolean AND team_id = $4 AND recommender_id IS NOT NULL)
)`;

function valeursDuPerimetre(agent: UtilisateurSession): unknown[] {
  return [
    agent.roles.includes('CONSEILLER'),
    agent.id,
    agent.roles.includes('SUPERVISEUR'),
    agent.teamId,
  ];
}
