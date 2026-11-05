import { describe, expect, it } from 'vitest';
import { uneDemande, unDossier } from './test/fabriques';
import { enDirhams, libelleClient, libelleDossier, libelleRole, type StatutDemande } from './types';

const STATUTS: StatutDemande[] = [
  'BROUILLON',
  'SOUMISE',
  'COMPLEMENT_DEMANDE',
  'ATTENTE_SUPERVISEUR',
  'APPROUVEE',
  'ACTIVE',
  'EXPIREE',
  'REJETEE',
  'ANNULEE',
  'ABANDONNEE',
];

describe('libelleClient : ce que voit le client', () => {
  it('a un libellé pour chacun des dix statuts', () => {
    for (const statut of STATUTS) {
      expect(libelleClient(uneDemande({ statut })).texte).not.toBe('');
    }
  });

  // Le cahier exige que le client voie la différence entre une décision favorable et un
  // plafond effectivement actif.
  it('distingue une décision favorable d’un plafond actif', () => {
    const approuvee = libelleClient(
      uneDemande({ statut: 'APPROUVEE', activationStatut: 'EN_ATTENTE' }),
    );
    const active = libelleClient(
      uneDemande({
        statut: 'ACTIVE',
        activationStatut: 'REUSSIE',
        dateEcheance: '2026-11-08T09:00:00Z',
      }),
    );

    expect(approuvee).toEqual({ texte: 'Décision favorable, activation en cours', ton: 'attente' });
    expect(active.ton).toBe('actif');
    expect(active.texte).toContain(`Plafond de ${enDirhams(25_000)} actif`);
  });

  it('dit que le plafond n’est pas encore actif après un échec ou une réponse perdue', () => {
    for (const activationStatut of ['ECHEC', 'INCONNU'] as const) {
      expect(libelleClient(uneDemande({ statut: 'APPROUVEE', activationStatut })).texte).toBe(
        'Décision favorable, plafond pas encore actif',
      );
    }
  });

  it('signale le complément comme une action requise', () => {
    expect(libelleClient(uneDemande({ statut: 'COMPLEMENT_DEMANDE' })).ton).toBe('action');
  });
});

describe('libelleDossier : ce que voit la banque', () => {
  it('montre le résultat de l’activation d’une demande approuvée', () => {
    expect(libelleDossier(unDossier({ statut: 'APPROUVEE', activationStatut: 'ECHEC' }))).toEqual({
      texte: 'Approuvée, activation en échec',
      ton: 'action',
    });
    expect(
      libelleDossier(unDossier({ statut: 'APPROUVEE', activationStatut: 'INCONNU' })).texte,
    ).toBe('Approuvée, activation résultat inconnu');
  });

  it('demande une action sur un dossier soumis ou transmis', () => {
    expect(libelleDossier(unDossier({ statut: 'SOUMISE' })).ton).toBe('action');
    expect(libelleDossier(unDossier({ statut: 'ATTENTE_SUPERVISEUR' })).ton).toBe('action');
  });
});

describe('libelleRole', () => {
  it('nomme le double rôle (H18)', () => {
    expect(libelleRole(['CONSEILLER', 'SUPERVISEUR'])).toBe('Conseiller et superviseur');
    expect(libelleRole(['SUPERVISEUR'])).toBe('Superviseur');
    expect(libelleRole(['CONSEILLER'])).toBe('Conseiller');
    expect(libelleRole(['CLIENT'])).toBe('Client');
  });
});
