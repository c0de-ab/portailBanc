import type { ErreurRegle } from './erreurs';

// Les états métier (colonne requests.statut), exactement comme dans la base.
export const STATUTS = [
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
] as const;
export type StatutDemande = (typeof STATUTS)[number];

// Les actions qui changent (ou rejouent) l'état d'une demande existante.
// La création du brouillon n'en fait pas partie : elle ne part d'aucun état.
export const ACTIONS = [
  'modifier',
  'abandonner',
  'soumettre',
  'demanderComplement',
  'approuver',
  'rejeter',
  'recommander',
  'annuler',
  'relancer',
  'confirmerActivation',
  'confirmerDesactivation',
] as const;
export type Action = (typeof ACTIONS)[number];

// Qui déclenche la transition. L'agent IA agit toujours pour le client.
export type Acteur = 'CLIENT' | 'CONSEILLER' | 'SUPERVISEUR' | 'SYSTEME';

type Transition = {
  action: Action;
  depuis: readonly StatutDemande[];
  vers: StatutDemande;
  acteurs: readonly Acteur[];
};

// LA table des transitions : la traduction exacte du diagramme des états
// Toute combinaison absente est impossible.
export const TRANSITIONS: readonly Transition[] = [
  // Brouillon et complément : seul le client (ou l'agent pour lui) modifie le contenu.
  { action: 'modifier', depuis: ['BROUILLON'], vers: 'BROUILLON', acteurs: ['CLIENT'] },
  {
    action: 'modifier',
    depuis: ['COMPLEMENT_DEMANDE'],
    vers: 'COMPLEMENT_DEMANDE',
    acteurs: ['CLIENT'],
  },
  // H10 : un brouillon abandonné n'est jamais supprimé.
  { action: 'abandonner', depuis: ['BROUILLON'], vers: 'ABANDONNEE', acteurs: ['CLIENT'] },
  // Soumission et resoumission, après confirmation (R1 à R7).
  {
    action: 'soumettre',
    depuis: ['BROUILLON', 'COMPLEMENT_DEMANDE'],
    vers: 'SOUMISE',
    acteurs: ['CLIENT'],
  },
  // H5 : le superviseur ne demande pas de complément.
  {
    action: 'demanderComplement',
    depuis: ['SOUMISE'],
    vers: 'COMPLEMENT_DEMANDE',
    acteurs: ['CONSEILLER'],
  },
  // Jusqu'à 30 000 DH, le conseiller décide sur une demande soumise (R8, vérifié par verifierDecision).
  { action: 'approuver', depuis: ['SOUMISE'], vers: 'APPROUVEE', acteurs: ['CONSEILLER'] },
  { action: 'rejeter', depuis: ['SOUMISE'], vers: 'REJETEE', acteurs: ['CONSEILLER'] },
  // Au-delà, il recommande, et le superviseur décide sur une demande transmise.
  {
    action: 'recommander',
    depuis: ['SOUMISE'],
    vers: 'ATTENTE_SUPERVISEUR',
    acteurs: ['CONSEILLER'],
  },
  {
    action: 'approuver',
    depuis: ['ATTENTE_SUPERVISEUR'],
    vers: 'APPROUVEE',
    acteurs: ['SUPERVISEUR'],
  },
  { action: 'rejeter', depuis: ['ATTENTE_SUPERVISEUR'], vers: 'REJETEE', acteurs: ['SUPERVISEUR'] },
  // R12 (et H3) : annulation possible jusqu'à la première décision d'approbation ou de rejet.
  {
    action: 'annuler',
    depuis: ['SOUMISE', 'COMPLEMENT_DEMANDE', 'ATTENTE_SUPERVISEUR'],
    vers: 'ANNULEE',
    acteurs: ['CLIENT'],
  },
  // H12, H15 : la relance rejoue l'activation, sans changer d'état.
  {
    action: 'relancer',
    depuis: ['APPROUVEE'],
    vers: 'APPROUVEE',
    acteurs: ['CONSEILLER', 'SUPERVISEUR'],
  },
  // Résultats de la banque simulée.
  { action: 'confirmerActivation', depuis: ['APPROUVEE'], vers: 'ACTIVE', acteurs: ['SYSTEME'] },
  { action: 'confirmerDesactivation', depuis: ['ACTIVE'], vers: 'EXPIREE', acteurs: ['SYSTEME'] },
];

// Les états où une première décision d'approbation ou de rejet a déjà été prise (R12).
const APRES_DECISION: readonly StatutDemande[] = ['APPROUVEE', 'ACTIVE', 'EXPIREE', 'REJETEE'];

export type ResultatTransition =
  | { possible: true; vers: StatutDemande; acteurs: readonly Acteur[] }
  | { possible: false; erreur: ErreurRegle };

// L'état d'arrivée de `action` depuis `statut`, ou l'erreur qui l'interdit :
// R13 pour une activation hors de l'état Approuvée, R12 pour une annulation après décision,
// TRANSITION pour toute autre combinaison absente de la table.
export function etatApres(action: Action, statut: StatutDemande): ResultatTransition {
  const transition = TRANSITIONS.find((t) => t.action === action && t.depuis.includes(statut));
  if (transition) {
    return { possible: true, vers: transition.vers, acteurs: transition.acteurs };
  }

  if (action === 'confirmerActivation' || action === 'relancer') {
    return {
      possible: false,
      erreur: {
        code: 'R13',
        message: "Aucune activation n'est possible hors de l'état « Approuvée ».",
      },
    };
  }
  if (action === 'annuler' && APRES_DECISION.includes(statut)) {
    return {
      possible: false,
      erreur: {
        code: 'R12',
        message:
          "La demande ne peut plus être annulée : une décision d'approbation ou de rejet a été prise.",
      },
    };
  }
  return {
    possible: false,
    erreur: {
      code: 'TRANSITION',
      message: `Action « ${action} » impossible dans l'état ${statut}.`,
    },
  };
}
