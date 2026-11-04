import type { StatutDemande } from '../domain/transitions';

// La table requests, telle que le code la manipule (CLAUDE.md, règle 13) : les fonctions
// d'accès convertissent chaque ligne avec versDemande, le reste du code ne voit jamais de
// ligne brute.
export type StatutExecution = 'EN_ATTENTE' | 'REUSSIE' | 'ECHEC' | 'INCONNU';

export interface Demande {
  id: string;
  reference: string | null;
  accountId: string;
  clientId: string;
  advisorId: string | null;
  teamId: string | null;
  statut: StatutDemande;
  // Compteur technique du contrôle de concurrence : transmis au frontend, jamais affiché (H14).
  version: number;
  plafondDemande: number | null;
  dureeJours: number | null;
  motif: string | null;
  justificatifFichier: string | null;
  justificatifNom: string | null;
  revisionCourante: number;
  recommenderId: string | null;
  activationStatut: StatutExecution | null;
  desactivationStatut: StatutExecution | null;
  derniereErreur: string | null;
  submittedAt: Date | null;
  dateActivation: Date | null;
  dateEcheance: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Les colonnes lues, toujours les mêmes : une liste écrite en dur, jamais une entrée.
export const COLONNES_DEMANDE = `id, reference, account_id, client_id, advisor_id, team_id, statut,
  version, plafond_demande, duree_jours, motif, justificatif_fichier, justificatif_nom,
  revision_courante, recommender_id, activation_statut, desactivation_statut, derniere_erreur,
  submitted_at, date_activation, date_echeance, created_at, updated_at`;

export type LigneDemande = {
  id: string;
  reference: string | null;
  account_id: string;
  client_id: string;
  advisor_id: string | null;
  team_id: string | null;
  statut: StatutDemande;
  version: number;
  plafond_demande: number | null;
  duree_jours: number | null;
  motif: string | null;
  justificatif_fichier: string | null;
  justificatif_nom: string | null;
  revision_courante: number;
  recommender_id: string | null;
  activation_statut: StatutExecution | null;
  desactivation_statut: StatutExecution | null;
  derniere_erreur: string | null;
  submitted_at: Date | null;
  date_activation: Date | null;
  date_echeance: Date | null;
  created_at: Date;
  updated_at: Date;
};

export function versDemande(ligne: LigneDemande): Demande {
  return {
    id: ligne.id,
    reference: ligne.reference,
    accountId: ligne.account_id,
    clientId: ligne.client_id,
    advisorId: ligne.advisor_id,
    teamId: ligne.team_id,
    statut: ligne.statut,
    version: ligne.version,
    plafondDemande: ligne.plafond_demande,
    dureeJours: ligne.duree_jours,
    motif: ligne.motif,
    justificatifFichier: ligne.justificatif_fichier,
    justificatifNom: ligne.justificatif_nom,
    revisionCourante: ligne.revision_courante,
    recommenderId: ligne.recommender_id,
    activationStatut: ligne.activation_statut,
    desactivationStatut: ligne.desactivation_statut,
    derniereErreur: ligne.derniere_erreur,
    submittedAt: ligne.submitted_at,
    dateActivation: ligne.date_activation,
    dateEcheance: ligne.date_echeance,
    createdAt: ligne.created_at,
    updatedAt: ligne.updated_at,
  };
}

// Ce que le CLIENT voit d'une demande. Ni le nom du fichier sur le disque, ni le conseiller,
// ni le recommandeur, ni le message d'erreur technique de la banque.
export type VueDemandeClient = {
  id: string;
  reference: string | null;
  compteId: string;
  statut: StatutDemande;
  version: number;
  plafondDemande: number | null;
  dureeJours: number | null;
  motif: string | null;
  justificatifNom: string | null;
  justificatifPresent: boolean;
  revisionCourante: number;
  activationStatut: StatutExecution | null;
  desactivationStatut: StatutExecution | null;
  submittedAt: Date | null;
  dateActivation: Date | null;
  dateEcheance: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function vueClient(demande: Demande): VueDemandeClient {
  return {
    id: demande.id,
    reference: demande.reference,
    compteId: demande.accountId,
    statut: demande.statut,
    version: demande.version,
    plafondDemande: demande.plafondDemande,
    dureeJours: demande.dureeJours,
    motif: demande.motif,
    justificatifNom: demande.justificatifNom,
    justificatifPresent: demande.justificatifFichier !== null,
    revisionCourante: demande.revisionCourante,
    activationStatut: demande.activationStatut,
    desactivationStatut: demande.desactivationStatut,
    submittedAt: demande.submittedAt,
    dateActivation: demande.dateActivation,
    dateEcheance: demande.dateEcheance,
    createdAt: demande.createdAt,
    updatedAt: demande.updatedAt,
  };
}
