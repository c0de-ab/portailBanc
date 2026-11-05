import { describe, expect, it } from 'vitest';
import { etapesDe } from './composants';
import { uneDemande } from './test/fabriques';
import { dateBreve } from './types';

// La frise : Brouillon, Examen, Décision, Activation, Échéance.
const etats = (d: Parameters<typeof etapesDe>[0]) => etapesDe(d)?.map((e) => e.etat);
const etape = (d: Parameters<typeof etapesDe>[0], nom: string) =>
  etapesDe(d)?.find((e) => e.nom === nom);

describe('etapesDe : la frise d’une demande', () => {
  it('place une demande soumise à l’examen', () => {
    expect(etats(uneDemande({ statut: 'SOUMISE' }))).toEqual([
      'fait',
      'encours',
      'avenir',
      'avenir',
      'avenir',
    ]);
  });

  it('garde un complément et une attente du superviseur à l’examen, sans activation', () => {
    for (const statut of ['COMPLEMENT_DEMANDE', 'ATTENTE_SUPERVISEUR'] as const) {
      expect(etape(uneDemande({ statut }), 'Examen')?.etat).toBe('encours');
      expect(etape(uneDemande({ statut }), 'Activation')?.etat).toBe('avenir');
    }
  });

  it('montre une décision favorable dont le plafond n’est pas encore appliqué', () => {
    for (const activationStatut of ['ECHEC', 'INCONNU'] as const) {
      const d = uneDemande({ statut: 'APPROUVEE', activationStatut });
      expect(etape(d, 'Décision')).toEqual({ nom: 'Décision', etat: 'fait', info: 'Favorable' });
      expect(etape(d, 'Activation')).toEqual({
        nom: 'Activation',
        etat: 'encours',
        info: 'Pas encore appliqué par la banque',
      });
    }
    expect(
      etape(uneDemande({ statut: 'APPROUVEE', activationStatut: 'EN_ATTENTE' }), 'Activation')
        ?.info,
    ).toBe('En cours auprès de la banque');
  });

  it('date l’application et l’échéance d’un plafond actif', () => {
    const d = uneDemande({
      statut: 'ACTIVE',
      activationStatut: 'REUSSIE',
      dateActivation: '2026-11-05T09:00:00Z',
      dateEcheance: '2026-11-08T09:00:00Z',
    });
    expect(etape(d, 'Activation')).toEqual({
      nom: 'Activation',
      etat: 'encours',
      info: `Appliqué le ${dateBreve('2026-11-05T09:00:00Z')}`,
    });
    expect(etape(d, 'Échéance')).toEqual({
      nom: 'Échéance',
      etat: 'avenir',
      info: dateBreve('2026-11-08T09:00:00Z'),
    });
  });

  it('arrête la frise à la décision pour un rejet', () => {
    const d = uneDemande({ statut: 'REJETEE' });
    expect(etape(d, 'Décision')).toEqual({ nom: 'Décision', etat: 'refus', info: 'Défavorable' });
    expect(etape(d, 'Activation')?.info).toBe('Sans objet');
    expect(etape(d, 'Échéance')?.info).toBe('Sans objet');
  });

  it('termine toutes les étapes d’une demande expirée', () => {
    expect(
      etats(uneDemande({ statut: 'EXPIREE', dateActivation: '2026-11-05T09:00:00Z' })),
    ).toEqual(['fait', 'fait', 'fait', 'fait', 'fait']);
  });

  it('n’a pas de frise pour une demande annulée ou un brouillon abandonné', () => {
    expect(etapesDe(uneDemande({ statut: 'ANNULEE' }))).toBeNull();
    expect(etapesDe(uneDemande({ statut: 'ABANDONNEE' }))).toBeNull();
  });
});
