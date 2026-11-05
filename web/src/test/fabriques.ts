import type { Demande, Dossier } from '../types';

// Une demande de test : un brouillon complet, que chaque test modifie selon son besoin.
export function uneDemande(changements: Partial<Demande> = {}): Demande {
  return {
    id: 'd1',
    reference: 'DEM-2026-000001',
    compteId: 'c1',
    statut: 'BROUILLON',
    version: 1,
    plafondDemande: 25_000,
    dureeJours: 3,
    motif: 'Achat d’une voiture',
    justificatifNom: null,
    justificatifPresent: false,
    revisionCourante: 1,
    activationStatut: null,
    desactivationStatut: null,
    submittedAt: '2026-11-02T09:00:00Z',
    dateActivation: null,
    dateEcheance: null,
    createdAt: '2026-11-02T08:00:00Z',
    updatedAt: '2026-11-02T09:00:00Z',
    ...changements,
  };
}

export function unDossier(changements: Partial<Dossier> = {}): Dossier {
  return {
    ...uneDemande(),
    advisorId: 'conseiller-1',
    teamId: 'equipe-1',
    recommenderId: null,
    derniereErreur: null,
    ...changements,
  };
}
