import { resumerResultat } from './agent.service';

describe('resumerResultat : le résultat d’un outil gardé en mémoire', () => {
  it('garde un résultat court tel quel', () => {
    const resultat = { comptes: [{ numero: 'DEMO-0001' }], dossierComplet: true };

    expect(resumerResultat(resultat)).toBe(resultat);
  });

  it('résume un résultat long en un objet valide, marqué comme tronqué', () => {
    const resultat = {
      demandes: Array.from({ length: 50 }, (_, i) => ({ reference: `DEM-${i}` })),
    };

    const resume = resumerResultat(resultat) as { tronque: boolean; debut: string };

    expect(resume.tronque).toBe(true);
    expect(resume.debut).toHaveLength(500);
    // Ce qui est transmis au modèle reste un JSON valide.
    expect(() => JSON.parse(JSON.stringify(resume)) as unknown).not.toThrow();
  });
});
