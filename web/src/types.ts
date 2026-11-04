// Statuts, libellés et formes des réponses, RECOPIÉS de l'API (pas de package partagé :
// docs/stack-technique.md). Les libellés client viennent de docs/etats-transitions.md, § 6.

export type Role = 'CLIENT' | 'CONSEILLER' | 'SUPERVISEUR';

export type Utilisateur = {
  id: string;
  displayName: string;
  roles: Role[];
  teamId: string | null;
  clientId: string | null;
};

export type StatutDemande =
  | 'BROUILLON'
  | 'SOUMISE'
  | 'COMPLEMENT_DEMANDE'
  | 'ATTENTE_SUPERVISEUR'
  | 'APPROUVEE'
  | 'ACTIVE'
  | 'EXPIREE'
  | 'REJETEE'
  | 'ANNULEE'
  | 'ABANDONNEE';

export type StatutExecution = 'EN_ATTENTE' | 'REUSSIE' | 'ECHEC' | 'INCONNU';

// Une erreur au format de l'API (CLAUDE.md, règle 8).
export type ErreurDetaillee = { code: string; champ?: string; message: string };

export type Demande = {
  id: string;
  reference: string | null;
  compteId: string;
  statut: StatutDemande;
  // Compteur technique : transmis à l'API, JAMAIS affiché (H14).
  version: number;
  plafondDemande: number | null;
  dureeJours: number | null;
  motif: string | null;
  justificatifNom: string | null;
  justificatifPresent: boolean;
  // La version métier, affichée (v1, v2…).
  revisionCourante: number;
  activationStatut: StatutExecution | null;
  desactivationStatut: StatutExecution | null;
  submittedAt: string | null;
  dateActivation: string | null;
  dateEcheance: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Compte = {
  id: string;
  numero: string;
  plafondInitial: number;
  plafondCourant: number;
  plafondTemporaireActif: boolean;
  demandeEnCours: { id: string; reference: string | null; statut: StatutDemande } | null;
};

export type DetailDemande = {
  demande: Demande;
  revisions: {
    revisionNo: number;
    plafondDemande: number;
    dureeJours: number;
    motif: string;
    justificatifNom: string | null;
    soumiseLe: string;
  }[];
  decisions: { type: string; motif: string; revisionNo: number; decideeLe: string }[];
};

// Les seuils des règles fictives, pour la jauge (le serveur reste seul juge).
export const PLAFOND_MAXIMUM = 100_000;
export const SEUIL_DECISION_CONSEILLER = 30_000;
export const SEUIL_JUSTIFICATIF = 50_000;

export const enDirhams = (montant: number) => `${montant.toLocaleString('fr-FR')} DH`;

export const dateLisible = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

// Le ton d'un état, pour sa couleur : en cours, favorable, effectif, terminé, en défaut.
export type Ton = 'neutre' | 'attente' | 'action' | 'actif' | 'termine' | 'refus';

// Ce que voit le client (docs/etats-transitions.md, § 6). La décision favorable et le plafond
// effectivement actif sont distingués, comme l'exige le cahier.
export function libelleClient(d: Demande): { texte: string; ton: Ton } {
  switch (d.statut) {
    case 'BROUILLON':
      return { texte: 'Brouillon, non soumis', ton: 'neutre' };
    case 'SOUMISE':
      return { texte: 'En cours d’examen', ton: 'attente' };
    case 'COMPLEMENT_DEMANDE':
      return { texte: 'Complément demandé : action requise', ton: 'action' };
    case 'ATTENTE_SUPERVISEUR':
      return { texte: 'En cours de validation', ton: 'attente' };
    case 'APPROUVEE':
      return d.activationStatut === 'ECHEC' || d.activationStatut === 'INCONNU'
        ? { texte: 'Décision favorable, plafond pas encore actif', ton: 'attente' }
        : { texte: 'Décision favorable, activation en cours', ton: 'attente' };
    case 'ACTIVE':
      return {
        texte: `Plafond de ${enDirhams(d.plafondDemande ?? 0)} actif jusqu’au ${
          d.dateEcheance ? dateLisible(d.dateEcheance) : '…'
        }`,
        ton: 'actif',
      };
    case 'EXPIREE':
      return { texte: 'Plafond temporaire expiré, plafond initial rétabli', ton: 'termine' };
    case 'REJETEE':
      return { texte: 'Demande rejetée', ton: 'refus' };
    case 'ANNULEE':
      return { texte: 'Demande annulée', ton: 'termine' };
    case 'ABANDONNEE':
      return { texte: 'Brouillon abandonné', ton: 'termine' };
  }
}

export const LIBELLE_DECISION: Record<string, string> = {
  DEMANDE_COMPLEMENT: 'Complément demandé',
  APPROBATION: 'Approuvée',
  REJET: 'Rejetée',
};
