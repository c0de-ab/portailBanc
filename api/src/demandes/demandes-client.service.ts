import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseError, type PoolClient } from 'pg';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import { BaseService } from '../base/base.service';
import { formaterReference } from '../domain/dates';
import type { ErreurRegle } from '../domain/erreurs';
import { type ContexteDemande, verifierRegles } from '../domain/regles';
import { type Action, etatApres, type StatutDemande } from '../domain/transitions';
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
import { COLONNES_DEMANDE, type Demande, type LigneDemande, versDemande } from './demande';
import { introuvable, refuser, versionPerimee } from './refus';
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
  revisions: {
    revisionNo: number;
    plafondDemande: number;
    dureeJours: number;
    motif: string;
    justificatifNom: string | null;
    soumiseLe: Date;
  }[];
  // H19 : le client voit les motifs de complément, d'approbation et de rejet, jamais ceux
  // des recommandations, qui restent internes à la banque.
  decisions: { type: string; motif: string; revisionNo: number; decideeLe: Date }[];
};

export type ContenuModifie = {
  plafondDemande?: number | null;
  dureeJours?: number | null;
  motif?: string | null;
};

export type Confirmation = { version: number; plafondDemande: number; dureeJours: number };

// Le parcours du client : brouillon, modification, soumission confirmée, abandon, annulation.
// Chaque action suit le même ordre (CLAUDE.md, règles 4, 5 et 11) : charger le dossier avec le
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

  async lister(client: UtilisateurSession): Promise<Demande[]> {
    const { rows } = await this.base.requete<LigneDemande>(
      `SELECT ${COLONNES_DEMANDE} FROM requests WHERE client_id = $1 ORDER BY created_at DESC`,
      [client.clientId],
    );
    return rows.map(versDemande);
  }

  detail(client: UtilisateurSession, id: string, maintenant: Date): Promise<DetailDemande> {
    return this.tracerLesRefus(client, 'consulter', id, maintenant, async () => {
      const demande = await this.charger(client, id);
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
      const demande = await this.charger(client, id);
      this.verifierVersion(demande, version);
      this.verifierTransition('modifier', demande.statut);

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

  // Soumission confirmée (R7, docs/modele-donnees.md § 4.1) : acceptée seulement si la demande
  // a encore la version, le montant et la durée que le client a confirmés.
  soumettre(
    client: UtilisateurSession,
    id: string,
    confirmation: Confirmation,
    maintenant: Date,
  ): Promise<Demande> {
    return this.tracerLesRefus(client, 'soumettre', id, maintenant, async () => {
      const demande = await this.charger(client, id);
      this.verifierTransition('soumettre', demande.statut);
      if (
        demande.version !== confirmation.version ||
        demande.plafondDemande !== confirmation.plafondDemande ||
        demande.dureeJours !== confirmation.dureeJours
      ) {
        throw confirmationARenouveler();
      }

      // R5 et le plafond initial sont relus en base, jamais pris dans la session.
      const contexte = await this.contexte(demande.accountId);
      const erreurs = verifierRegles(contenuDe(demande), contexte);
      if (erreurs.length > 0) {
        throw refuser(erreurs);
      }

      try {
        return await this.base.transaction(async (tx) => {
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

  // Dépose le justificatif, en Brouillon ou en Complément demandé : c'est une modification du
  // contenu, la version avance. Un nouveau dépôt remplace le justificatif de la demande, mais
  // l'ancien fichier n'est jamais supprimé (une révision peut y faire référence).
  deposerJustificatif(
    client: UtilisateurSession,
    id: string,
    version: number,
    fichier: FichierRecu | undefined,
    maintenant: Date,
  ): Promise<DemandeEtAvertissements> {
    return this.tracerLesRefus(client, 'deposerJustificatif', id, maintenant, async () => {
      const demande = await this.charger(client, id);
      this.verifierVersion(demande, version);
      this.verifierTransition('modifier', demande.statut);

      const type = controlerFichier(fichier);
      // Le nom sur le disque est généré par le serveur ; le nom d'origine ne sert qu'à l'affichage.
      const nomStocke = `${randomUUID()}.${type}`;
      const nomAffiche = nomAffichable(fichier!.originalname);
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
        await writeFile(cheminDe(nomStocke), fichier!.buffer, { flag: 'wx' });
        const resultat = versDemande(rows[0]);
        await this.historique.ecrire(
          {
            action: 'JUSTIFICATIF_DEPOSE',
            acteurId: client.id,
            requestId: id,
            reference: resultat.reference,
            requestVersion: resultat.version,
            details: { type, taille: fichier!.size },
            date: maintenant,
          },
          tx,
        );
        return resultat;
      });

      return { demande: modifiee, avertissements: await this.avertissements(modifiee) };
    });
  }

  // Le justificatif à télécharger, après le filtre de périmètre (404 sinon).
  lireJustificatif(
    client: UtilisateurSession,
    id: string,
    maintenant: Date,
  ): Promise<JustificatifATelecharger> {
    return this.tracerLesRefus(client, 'telechargerJustificatif', id, maintenant, async () => {
      const demande = await this.charger(client, id);
      return justificatifATelecharger(demande.justificatifFichier, demande.justificatifNom);
    });
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
      const demande = await this.charger(client, id);
      this.verifierVersion(demande, version);
      const vers = this.verifierTransition(action, demande.statut);

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

  // Règle 4 : le filtre de périmètre est DANS la requête. Hors périmètre ou inexistant : 404.
  private async charger(client: UtilisateurSession, id: string): Promise<Demande> {
    const { rows } = await this.base.requete<LigneDemande>(
      `SELECT ${COLONNES_DEMANDE} FROM requests WHERE id = $1 AND client_id = $2`,
      [id, client.clientId],
    );
    if (!rows[0]) {
      throw introuvable();
    }
    return versDemande(rows[0]);
  }

  private verifierVersion(demande: Demande, version: number): void {
    if (demande.version !== version) {
      throw versionPerimee();
    }
  }

  private verifierTransition(action: Action, statut: StatutDemande): StatutDemande {
    const resultat = etatApres(action, statut);
    if (!resultat.possible) {
      throw refuser([resultat.erreur]);
    }
    return resultat.vers;
  }

  // Ce que la demande doit à son compte et à son client, relu en base.
  private async contexte(
    compteId: string,
  ): Promise<ContexteDemande & { conseillerId: string; equipeId: string | null }> {
    const { rows } = await this.base.requete<{
      plafond_initial: number;
      dossier_complet: boolean;
      advisor_id: string;
      team_id: string | null;
    }>(
      `SELECT a.plafond_initial, c.dossier_complet, c.advisor_id, u.team_id
         FROM accounts a
         JOIN clients c ON c.id = a.client_id
         JOIN users u ON u.id = c.advisor_id
        WHERE a.id = $1`,
      [compteId],
    );
    const ligne = rows[0];
    return {
      plafondInitial: ligne.plafond_initial,
      dossierComplet: ligne.dossier_complet,
      conseillerId: ligne.advisor_id,
      equipeId: ligne.team_id,
    };
  }

  // H23 : les mêmes règles que la soumission, en avertissements.
  private async avertissements(demande: Demande): Promise<ErreurRegle[]> {
    return verifierRegles(contenuDe(demande), await this.contexte(demande.accountId));
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

function contenuDe(demande: Demande) {
  return {
    plafondDemande: demande.plafondDemande,
    dureeJours: demande.dureeJours,
    motif: demande.motif,
    justificatifPresent: demande.justificatifFichier !== null,
  };
}

// Le fichier reçu doit exister, et son type RÉEL, lu sur ses premiers octets, doit être accepté
// ET correspondre au type annoncé par le navigateur. La taille (2 Mo) est déjà bornée par Multer.
function controlerFichier(fichier: FichierRecu | undefined): TypeJustificatif {
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
  return type;
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
