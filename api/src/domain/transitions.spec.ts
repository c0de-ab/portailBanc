import { ACTIONS, type Action, etatApres, STATUTS, type StatutDemande } from './transitions';

// Le diagramme des états, recopié ici À LA MAIN et non
// dérivé de la table du code : le test compare deux écritures indépendantes du même diagramme.
const DIAGRAMME: [Action, StatutDemande, StatutDemande][] = [
  ['modifier', 'BROUILLON', 'BROUILLON'],
  ['modifier', 'COMPLEMENT_DEMANDE', 'COMPLEMENT_DEMANDE'],
  ['abandonner', 'BROUILLON', 'ABANDONNEE'],
  ['soumettre', 'BROUILLON', 'SOUMISE'],
  ['soumettre', 'COMPLEMENT_DEMANDE', 'SOUMISE'],
  ['demanderComplement', 'SOUMISE', 'COMPLEMENT_DEMANDE'],
  ['approuver', 'SOUMISE', 'APPROUVEE'],
  ['rejeter', 'SOUMISE', 'REJETEE'],
  ['recommander', 'SOUMISE', 'ATTENTE_SUPERVISEUR'],
  ['approuver', 'ATTENTE_SUPERVISEUR', 'APPROUVEE'],
  ['rejeter', 'ATTENTE_SUPERVISEUR', 'REJETEE'],
  ['annuler', 'SOUMISE', 'ANNULEE'],
  ['annuler', 'COMPLEMENT_DEMANDE', 'ANNULEE'],
  ['annuler', 'ATTENTE_SUPERVISEUR', 'ANNULEE'],
  ['relancer', 'APPROUVEE', 'APPROUVEE'],
  ['confirmerActivation', 'APPROUVEE', 'ACTIVE'],
  ['confirmerDesactivation', 'ACTIVE', 'EXPIREE'],
];

function arriveeAttendue(action: Action, statut: StatutDemande): StatutDemande | undefined {
  return DIAGRAMME.find(([a, depuis]) => a === action && depuis === statut)?.[2];
}

// Le code attendu pour une combinaison absente du diagramme.
function codeDeRefusAttendu(action: Action, statut: StatutDemande): string {
  if (action === 'relancer' || action === 'confirmerActivation') return 'R13';
  if (action === 'annuler' && ['APPROUVEE', 'ACTIVE', 'EXPIREE', 'REJETEE'].includes(statut))
    return 'R12';
  return 'TRANSITION';
}

// Toutes les combinaisons action × état : 11 actions × 10 états = 110 cas.
const TOUTES = ACTIONS.flatMap((action) => STATUTS.map((statut) => [action, statut] as const));

describe('Table des transitions', () => {
  it.each(TOUTES)('%s depuis %s', (action, statut) => {
    const resultat = etatApres(action, statut);
    const attendue = arriveeAttendue(action, statut);

    if (attendue) {
      expect(resultat).toMatchObject({ possible: true, vers: attendue });
    } else {
      expect(resultat).toMatchObject({
        possible: false,
        erreur: { code: codeDeRefusAttendu(action, statut) },
      });
    }
  });

  it('les états finaux n’ont aucune transition sortante', () => {
    for (const statut of ['REJETEE', 'ANNULEE', 'EXPIREE', 'ABANDONNEE'] as const) {
      for (const action of ACTIONS) {
        expect(etatApres(action, statut).possible).toBe(false);
      }
    }
  });

  describe('Acteurs', () => {
    const acteurs = (action: Action, statut: StatutDemande) => {
      const resultat = etatApres(action, statut);
      return resultat.possible ? resultat.acteurs : [];
    };

    it('sur une demande soumise, le conseiller décide ; sur une demande transmise, le superviseur (H18)', () => {
      expect(acteurs('approuver', 'SOUMISE')).toEqual(['CONSEILLER']);
      expect(acteurs('approuver', 'ATTENTE_SUPERVISEUR')).toEqual(['SUPERVISEUR']);
      expect(acteurs('rejeter', 'ATTENTE_SUPERVISEUR')).toEqual(['SUPERVISEUR']);
    });

    it('seul le conseiller demande un complément ou recommande (H5)', () => {
      expect(acteurs('demanderComplement', 'SOUMISE')).toEqual(['CONSEILLER']);
      expect(acteurs('recommander', 'SOUMISE')).toEqual(['CONSEILLER']);
    });

    it('seul le client modifie, soumet, abandonne ou annule', () => {
      expect(acteurs('modifier', 'BROUILLON')).toEqual(['CLIENT']);
      expect(acteurs('soumettre', 'COMPLEMENT_DEMANDE')).toEqual(['CLIENT']);
      expect(acteurs('abandonner', 'BROUILLON')).toEqual(['CLIENT']);
      expect(acteurs('annuler', 'ATTENTE_SUPERVISEUR')).toEqual(['CLIENT']);
    });

    it('la relance est faite par le conseiller ou le superviseur (H12), les résultats bancaires par le système', () => {
      expect(acteurs('relancer', 'APPROUVEE')).toEqual(['CONSEILLER', 'SUPERVISEUR']);
      expect(acteurs('confirmerActivation', 'APPROUVEE')).toEqual(['SYSTEME']);
      expect(acteurs('confirmerDesactivation', 'ACTIVE')).toEqual(['SYSTEME']);
    });
  });
});
