// Statuts, libellés et formes des réponses, RECOPIÉS de l'API : pas de package partagé, pour
// garder deux projets simples et indépendants.

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

// Une erreur au format de l'API.
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
// Une durée en jours, au singulier ou au pluriel : « 1 jour », « 3 jours ».
export const enJours = (jours: number) => `${jours} jour${jours > 1 ? 's' : ''}`;

export const dateCourte = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'long' });

export const dateLisible = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

// Le ton d'un état, pour sa couleur : en cours, favorable, effectif, terminé, en défaut.
export type Ton = 'neutre' | 'attente' | 'action' | 'actif' | 'termine' | 'refus';

// Ce que voit le client. La décision favorable et le plafond
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
  RECOMMANDATION_FAVORABLE: 'Recommandation favorable',
  RECOMMANDATION_DEFAVORABLE: 'Recommandation défavorable',
};

// Le chat de l'agent (POST /api/agent/messages). Trois natures de message, à ne jamais confondre :
// la donnée du système (résultat d'un outil), l'explication du modèle (texte non fiable) et
// l'action réalisée. La carte de confirmation est la seule voie vers la soumission (R7).
export type CarteConfirmation = {
  demandeId: string;
  // Transmise à la soumission, jamais affichée (H14).
  version: number;
  plafondDemande: number;
  dureeJours: number;
  motif: string;
  justificatifNom: string | null;
};

export type ElementAgent =
  | { type: 'donnee'; outil: string; contenu: unknown }
  | { type: 'explication'; texte: string }
  | { type: 'action'; texte: string; demandeId: string }
  | { type: 'confirmation'; carte: CarteConfirmation };

// Le traitement des dossiers par le personnel de la banque (étape 8c).
export type Dossier = Demande & {
  advisorId: string | null;
  teamId: string | null;
  recommenderId: string | null;
  derniereErreur: string | null;
};

export type DetailDossier = {
  demande: Dossier;
  client: { nom: string; dossierComplet: boolean };
  // plafondCourant : ce que la banque applique réellement.
  compte: { numero: string; plafondInitial: number; plafondCourant: number };
  revisions: DetailDemande['revisions'];
  // Les décisions que l'utilisateur connecté peut prendre, calculées par l'API.
  actions: ('demanderComplement' | 'approuver' | 'rejeter' | 'recommander')[];
  // Le personnel voit toutes les décisions, recommandations comprises (H19).
  decisions: {
    type: string;
    acteur: string;
    role: Role;
    motif: string;
    requestVersion: number;
    revisionNo: number;
    decideeLe: string;
  }[];
  historique: {
    action: string;
    acteur: string | null;
    viaAgent: boolean;
    requestVersion: number | null;
    motif: string | null;
    date: string;
  }[];
};

export type ModeBanque = 'SUCCES' | 'ECHEC' | 'REPONSE_PERDUE';

export const LIBELLE_MODE_BANQUE: Record<ModeBanque, string> = {
  SUCCES: 'Normal',
  ECHEC: 'Échec des opérations',
  REPONSE_PERDUE: 'Réponse perdue',
};

// Ce que voit le personnel : le statut interne, plus précis que le libellé client.
export const LIBELLE_STATUT: Record<StatutDemande, string> = {
  BROUILLON: 'Brouillon',
  SOUMISE: 'Soumise',
  COMPLEMENT_DEMANDE: 'Complément demandé',
  ATTENTE_SUPERVISEUR: 'En attente du superviseur',
  APPROUVEE: 'Approuvée',
  ACTIVE: 'Active',
  EXPIREE: 'Expirée',
  REJETEE: 'Rejetée',
  ANNULEE: 'Annulée',
  ABANDONNEE: 'Abandonnée',
};

export const LIBELLE_EXECUTION: Record<StatutExecution, string> = {
  EN_ATTENTE: 'en attente',
  REUSSIE: 'réussie',
  ECHEC: 'en échec',
  INCONNU: 'résultat inconnu',
};

export function libelleDossier(d: Dossier): { texte: string; ton: Ton } {
  const texte = LIBELLE_STATUT[d.statut];
  switch (d.statut) {
    case 'SOUMISE':
    case 'ATTENTE_SUPERVISEUR':
      return { texte, ton: 'action' };
    case 'APPROUVEE':
      return {
        texte: `${texte}, activation ${LIBELLE_EXECUTION[d.activationStatut ?? 'EN_ATTENTE']}`,
        ton:
          d.activationStatut === 'ECHEC' || d.activationStatut === 'INCONNU' ? 'action' : 'attente',
      };
    case 'ACTIVE':
      return { texte, ton: 'actif' };
    case 'REJETEE':
      return { texte, ton: 'refus' };
    case 'COMPLEMENT_DEMANDE':
      return { texte, ton: 'attente' };
    default:
      return { texte, ton: 'termine' };
  }
}

// Date brève, pour la frise et les tableaux : « 4 nov. 2026 à 22:07 ».
export const dateBreve = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// Le rôle affiché dans la barre : copie de la session, sans autre donnée.
export function libelleRole(roles: Role[]): string {
  if (roles.includes('CLIENT')) {
    return 'Client';
  }
  if (roles.includes('CONSEILLER') && roles.includes('SUPERVISEUR')) {
    return 'Conseiller et superviseur';
  }
  return roles.includes('SUPERVISEUR') ? 'Superviseur' : 'Conseiller';
}

// L'historique d'un dossier : les codes d'événement de l'API, traduits pour l'affichage.
// Un code inconnu est affiché tel quel.
export const LIBELLE_EVENEMENT: Record<string, string> = {
  BROUILLON_CREE: 'Brouillon créé',
  MODIFICATION: 'Brouillon modifié',
  JUSTIFICATIF_DEPOSE: 'Justificatif déposé',
  SOUMISSION: 'Demande soumise',
  ANNULATION: 'Demande annulée',
  ABANDON: 'Brouillon abandonné',
  DEMANDE_COMPLEMENT: 'Complément demandé',
  RECOMMANDATION: 'Recommandation transmise au superviseur',
  RECOMMANDATION_FAVORABLE: 'Recommandation favorable, transmise au superviseur',
  RECOMMANDATION_DEFAVORABLE: 'Recommandation défavorable, transmise au superviseur',
  APPROBATION: 'Demande approuvée',
  REJET: 'Demande rejetée',
  ACTIVATION_REUSSIE: 'Plafond activé par la banque',
  ACTIVATION_ECHEC: 'Activation refusée par la banque',
  ACTIVATION_INCONNUE: 'Activation sans réponse de la banque',
  RELANCE: 'Activation relancée',
  EXPIRATION: 'Plafond temporaire expiré',
  DESACTIVATION_ECHEC: 'Désactivation refusée par la banque',
  DESACTIVATION_INCONNUE: 'Désactivation sans réponse de la banque',
  AGENT_OUTIL: 'Outil de l’assistant utilisé',
  REFUS: 'Action refusée par le serveur',
};
