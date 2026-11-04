import { calculerEcheance, formaterReference } from './dates';

describe('calculerEcheance (H8)', () => {
  it('3 jours courent 72 heures à partir de la date d’activation', () => {
    expect(calculerEcheance(new Date('2026-11-04T15:30:00Z'), 3)).toEqual(
      new Date('2026-11-07T15:30:00Z'),
    );
  });

  it('ne dépend pas du calendrier : un passage de mois ou d’année reste une durée glissante', () => {
    expect(calculerEcheance(new Date('2026-12-30T23:00:00Z'), 7)).toEqual(
      new Date('2027-01-06T23:00:00Z'),
    );
  });
});

describe('formaterReference (H13)', () => {
  it('produit DEM-<année>-<numéro sur 6 chiffres>', () => {
    expect(formaterReference(new Date('2026-11-04T10:00:00Z'), 123)).toBe('DEM-2026-000123');
  });

  it('lit l’année en UTC', () => {
    // 31 décembre à 23 h 30 en UTC : encore 2026, même là où il est déjà minuit passé.
    expect(formaterReference(new Date('2026-12-31T23:30:00Z'), 1)).toBe('DEM-2026-000001');
  });
});
