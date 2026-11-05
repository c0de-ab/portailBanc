import { describe, expect, it } from 'vitest';
import { unDossier } from '../../test/fabriques';
import { activationAReprendre, aTraiter } from './ListeDossiers';

describe('aTraiter : la file « À traiter »', () => {
  it('donne au conseiller les demandes soumises, et seulement elles', () => {
    expect(aTraiter(unDossier({ statut: 'SOUMISE' }), ['CONSEILLER'])).toBe(true);
    expect(aTraiter(unDossier({ statut: 'ATTENTE_SUPERVISEUR' }), ['CONSEILLER'])).toBe(false);
  });

  it('donne au superviseur les demandes transmises, et seulement elles', () => {
    expect(aTraiter(unDossier({ statut: 'ATTENTE_SUPERVISEUR' }), ['SUPERVISEUR'])).toBe(true);
    expect(aTraiter(unDossier({ statut: 'SOUMISE' }), ['SUPERVISEUR'])).toBe(false);
  });

  it('donne les deux files à un utilisateur à double rôle (H18)', () => {
    const roles = ['CONSEILLER', 'SUPERVISEUR'] as const;
    expect(aTraiter(unDossier({ statut: 'SOUMISE' }), [...roles])).toBe(true);
    expect(aTraiter(unDossier({ statut: 'ATTENTE_SUPERVISEUR' }), [...roles])).toBe(true);
  });

  it('ne met dans la file aucune demande sans décision à prendre', () => {
    for (const statut of [
      'COMPLEMENT_DEMANDE',
      'APPROUVEE',
      'ACTIVE',
      'REJETEE',
      'ANNULEE',
    ] as const) {
      expect(aTraiter(unDossier({ statut }), ['CONSEILLER', 'SUPERVISEUR'])).toBe(false);
    }
  });
});

describe('activationAReprendre : la file « Activation à reprendre »', () => {
  it('reprend une activation en échec ou au résultat inconnu', () => {
    expect(
      activationAReprendre(unDossier({ statut: 'APPROUVEE', activationStatut: 'ECHEC' })),
    ).toBe(true);
    expect(
      activationAReprendre(unDossier({ statut: 'APPROUVEE', activationStatut: 'INCONNU' })),
    ).toBe(true);
  });

  it('ne reprend ni une activation en cours, ni un plafond déjà actif', () => {
    expect(
      activationAReprendre(unDossier({ statut: 'APPROUVEE', activationStatut: 'EN_ATTENTE' })),
    ).toBe(false);
    expect(activationAReprendre(unDossier({ statut: 'ACTIVE', activationStatut: 'REUSSIE' }))).toBe(
      false,
    );
  });
});
