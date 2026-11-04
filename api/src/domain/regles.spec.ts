import {
  type ContenuDemande,
  type ContexteDemande,
  type Decision,
  niveauDeValidation,
  verifierDecision,
  verifierRegles,
} from './regles';

// Une demande valide de 25 000 DH pour 3 jours (scénario 1) ; chaque test en change un point.
const VALIDE: ContenuDemande = {
  plafondDemande: 25_000,
  dureeJours: 3,
  motif: 'Achat d’un véhicule',
  justificatifPresent: false,
};
const CONTEXTE: ContexteDemande = { plafondInitial: 10_000, dossierComplet: true };

function codes(contenu: Partial<ContenuDemande>, contexte: Partial<ContexteDemande> = {}) {
  return verifierRegles({ ...VALIDE, ...contenu }, { ...CONTEXTE, ...contexte }).map((e) => e.code);
}

describe('verifierRegles', () => {
  it('ne renvoie aucune erreur pour une demande valide', () => {
    expect(codes({})).toEqual([]);
  });

  describe('R1 : plafond total, au-dessus du plafond initial, au plus 100 000 DH', () => {
    // Avec un justificatif, pour que R4 n'interfère pas avec les bornes hautes.
    it.each([
      [10_000, ['R1']],
      [10_001, []],
      [100_000, []],
      [100_001, ['R1']],
    ])('%i DH -> %j', (plafondDemande, attendu) => {
      expect(codes({ plafondDemande, justificatifPresent: true })).toEqual(attendu);
    });

    it('refuse un plafond manquant', () => {
      expect(codes({ plafondDemande: null })).toEqual(['R1']);
    });

    it('refuse un montant non entier', () => {
      expect(codes({ plafondDemande: 25_000.5 })).toEqual(['R1']);
    });

    it('compare au plafond initial du compte, pas à une constante', () => {
      expect(codes({ plafondDemande: 12_000 }, { plafondInitial: 15_000 })).toEqual(['R1']);
    });
  });

  describe('R2 : durée de 1 à 7 jours', () => {
    it.each([
      [0, ['R2']],
      [1, []],
      [7, []],
      [8, ['R2']],
    ])('%i jour(s) -> %j', (dureeJours, attendu) => {
      expect(codes({ dureeJours })).toEqual(attendu);
    });

    it('refuse une durée manquante ou non entière', () => {
      expect(codes({ dureeJours: null })).toEqual(['R2']);
      expect(codes({ dureeJours: 2.5 })).toEqual(['R2']);
    });
  });

  describe('R3 : motif obligatoire', () => {
    it.each([null, '', '   '])('refuse le motif %j', (motif) => {
      expect(codes({ motif })).toEqual(['R3']);
    });
  });

  describe('R4 : justificatif obligatoire au-delà de 50 000 DH', () => {
    it.each([
      [50_000, false, []],
      [50_001, false, ['R4']],
      [50_001, true, []],
    ])('%i DH, justificatif %s -> %j', (plafondDemande, justificatifPresent, attendu) => {
      expect(codes({ plafondDemande, justificatifPresent })).toEqual(attendu);
    });
  });

  describe('R5 : dossier client incomplet', () => {
    it('bloque la soumission, sans porter sur un champ', () => {
      const erreurs = verifierRegles(VALIDE, { ...CONTEXTE, dossierComplet: false });

      expect(erreurs).toEqual([expect.objectContaining({ code: 'R5' })]);
      expect(erreurs[0].champ).toBeUndefined();
    });
  });

  it('renvoie toutes les erreurs à la fois, avec leur champ', () => {
    // 60 000 DH sans justificatif ni motif, dossier incomplet (proche du scénario 2).
    const erreurs = verifierRegles(
      { plafondDemande: 60_000, dureeJours: 3, motif: null, justificatifPresent: false },
      { ...CONTEXTE, dossierComplet: false },
    );

    expect(erreurs.map((e) => [e.code, e.champ])).toEqual([
      ['R3', 'motif'],
      ['R4', 'justificatif'],
      ['R5', undefined],
    ]);
  });

  it('un brouillon vide reçoit une erreur par champ manquant (les avertissements de H23)', () => {
    const erreurs = verifierRegles(
      { plafondDemande: null, dureeJours: null, motif: null, justificatifPresent: false },
      CONTEXTE,
    );

    expect(erreurs.map((e) => e.code)).toEqual(['R1', 'R2', 'R3']);
  });

  it('chaque erreur porte un message en français', () => {
    const [erreur] = verifierRegles({ ...VALIDE, plafondDemande: 10_000 }, CONTEXTE);

    expect(erreur.message).toMatch(/supérieur au plafond initial/);
  });
});

describe('niveauDeValidation (R8)', () => {
  it.each([
    [30_000, 'CONSEILLER'],
    [30_001, 'SUPERVISEUR'],
  ])('%i DH -> %s', (plafondDemande, attendu) => {
    expect(niveauDeValidation(plafondDemande)).toBe(attendu);
  });
});

describe('verifierDecision', () => {
  const LEILA = 'utilisateur-leila';
  const OMAR = 'utilisateur-omar';

  function codesDecision(
    decision: Partial<Decision>,
    plafondDemande: number,
    recommenderId: string | null = null,
  ) {
    const complete: Decision = {
      type: 'APPROBATION',
      role: 'CONSEILLER',
      acteurId: LEILA,
      motif: 'Motif',
      ...decision,
    };
    return verifierDecision(complete, { plafondDemande, recommenderId }).map((e) => e.code);
  }

  describe('R8 : niveau de validation selon le montant', () => {
    it.each(['APPROBATION', 'REJET'] as const)(
      'le conseiller peut décider (%s) jusqu’à 30 000 DH inclus, pas au-delà',
      (type) => {
        expect(codesDecision({ type }, 30_000)).toEqual([]);
        expect(codesDecision({ type }, 30_001)).toEqual(['R8']);
      },
    );

    it('le conseiller recommande au-delà de 30 000 DH, et jamais en dessous', () => {
      expect(codesDecision({ type: 'RECOMMANDATION' }, 30_001)).toEqual([]);
      expect(codesDecision({ type: 'RECOMMANDATION' }, 30_000)).toEqual(['R8']);
    });

    it('le conseiller peut demander un complément quel que soit le montant', () => {
      expect(codesDecision({ type: 'DEMANDE_COMPLEMENT' }, 30_000)).toEqual([]);
      expect(codesDecision({ type: 'DEMANDE_COMPLEMENT' }, 60_000)).toEqual([]);
    });

    it('le superviseur décide au-delà de 30 000 DH', () => {
      expect(codesDecision({ role: 'SUPERVISEUR', acteurId: OMAR }, 60_000, LEILA)).toEqual([]);
    });
  });

  describe('R9 : celui qui a recommandé ne valide pas comme superviseur', () => {
    it('refuse à l’utilisatrice à double rôle de valider ce qu’elle a recommandé', () => {
      expect(codesDecision({ role: 'SUPERVISEUR', acteurId: LEILA }, 60_000, LEILA)).toEqual([
        'R9',
      ]);
      expect(
        codesDecision({ role: 'SUPERVISEUR', acteurId: LEILA, type: 'REJET' }, 60_000, LEILA),
      ).toEqual(['R9']);
    });

    it('accepte un autre superviseur', () => {
      expect(codesDecision({ role: 'SUPERVISEUR', acteurId: OMAR }, 60_000, LEILA)).toEqual([]);
    });
  });

  describe('R10 : toute décision comporte un motif', () => {
    it.each([null, '', '  '])('refuse le motif %j', (motif) => {
      expect(codesDecision({ motif }, 25_000)).toEqual(['R10']);
    });
  });

  it('renvoie toutes les erreurs à la fois', () => {
    expect(codesDecision({ motif: '' }, 60_000)).toEqual(['R8', 'R10']);
  });
});
