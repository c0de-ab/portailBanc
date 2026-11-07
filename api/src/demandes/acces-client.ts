import type { UtilisateurSession } from '../auth/utilisateur-session';
import type { BaseService } from '../base/base.service';
import type { ErreurRegle } from '../domain/erreurs';
import { type ContexteDemande, verifierRegles } from '../domain/regles';
import { type Action, etatApres, type StatutDemande } from '../domain/transitions';
import { COLONNES_DEMANDE, type Demande, type LigneDemande, versDemande } from './demande';
import { introuvable, refuser, versionPerimee } from './refus';

// Les étapes communes aux actions du client, partagées par ses trois services (demandes,
// soumission, justificatif). Chaque action les enchaîne dans le même ordre : charger avec le
// filtre de périmètre, vérifier la version, demander à la table des transitions.

// Règle 4 : le filtre de périmètre est DANS la requête. Hors périmètre ou inexistant : 404.
export async function chargerDuClient(
  base: BaseService,
  client: UtilisateurSession,
  id: string,
): Promise<Demande> {
  const { rows } = await base.requete<LigneDemande>(
    `SELECT ${COLONNES_DEMANDE} FROM requests WHERE id = $1 AND client_id = $2`,
    [id, client.clientId],
  );
  if (!rows[0]) {
    throw introuvable();
  }
  return versDemande(rows[0]);
}

// R11 : l'action porte sur la version que le client a vue.
export function verifierVersion(demande: Demande, version: number): void {
  if (demande.version !== version) {
    throw versionPerimee();
  }
}

// La table des transitions dit si l'action est possible depuis ce statut, et vers quel statut.
export function verifierTransition(action: Action, statut: StatutDemande): StatutDemande {
  const resultat = etatApres(action, statut);
  if (!resultat.possible) {
    throw refuser([resultat.erreur]);
  }
  return resultat.vers;
}

export type ContexteCompte = ContexteDemande & { conseillerId: string; equipeId: string | null };

// Ce que la demande doit à son compte et à son client, toujours relu en base (R5 compris).
export async function contexteDuCompte(
  base: BaseService,
  compteId: string,
): Promise<ContexteCompte> {
  const { rows } = await base.requete<{
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

// Le contenu de la demande, tel que les règles du domaine le lisent.
export function contenuDe(demande: Demande) {
  return {
    plafondDemande: demande.plafondDemande,
    dureeJours: demande.dureeJours,
    motif: demande.motif,
    justificatifPresent: demande.justificatifFichier !== null,
  };
}

// H23 : les mêmes règles que la soumission, en avertissements qui ne bloquent rien.
export async function avertissementsDe(
  base: BaseService,
  demande: Demande,
): Promise<ErreurRegle[]> {
  return verifierRegles(contenuDe(demande), await contexteDuCompte(base, demande.accountId));
}
