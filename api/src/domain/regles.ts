import { enDirhams, type ErreurRegle } from './erreurs';
import {
  DUREE_MAXIMUM_JOURS,
  DUREE_MINIMUM_JOURS,
  PLAFOND_MAXIMUM,
  SEUIL_DECISION_CONSEILLER,
  SEUIL_JUSTIFICATIF,
} from './seuils';

// Le contenu d'une demande, tel qu'il est saisi. Les champs peuvent manquer : un brouillon
// est enregistré même incomplet, avec des avertissements (H23).
export type ContenuDemande = {
  plafondDemande: number | null;
  dureeJours: number | null;
  motif: string | null;
  justificatifPresent: boolean;
};

// Ce que la demande doit à son compte et à son client.
export type ContexteDemande = {
  // Lu sur le compte (accounts.plafond_initial) ; 10 000 DH pour tous les comptes (H11).
  plafondInitial: number;
  // R5.
  dossierComplet: boolean;
};

// Vérifie R1 à R5 et renvoie la liste COMPLÈTE des erreurs, sans lever d'exception.
// À la soumission, le service transforme cette liste en refus (422) ;
// sur un brouillon, en avertissements qui ne bloquent rien (H23).
export function verifierRegles(contenu: ContenuDemande, contexte: ContexteDemande): ErreurRegle[] {
  const erreurs: ErreurRegle[] = [];
  const { plafondDemande, dureeJours, motif, justificatifPresent } = contenu;

  // R1 : montant total, entier, strictement supérieur au plafond initial, au plus 100 000 DH.
  if (plafondDemande === null) {
    erreurs.push({
      code: 'R1',
      champ: 'plafondDemande',
      message: 'Le plafond demandé est obligatoire.',
    });
  } else if (!Number.isInteger(plafondDemande)) {
    erreurs.push({
      code: 'R1',
      champ: 'plafondDemande',
      message: 'Le plafond demandé doit être un nombre entier de dirhams.',
    });
  } else if (plafondDemande <= contexte.plafondInitial) {
    erreurs.push({
      code: 'R1',
      champ: 'plafondDemande',
      message: `Le plafond demandé doit être supérieur au plafond initial (${enDirhams(contexte.plafondInitial)}).`,
    });
  } else if (plafondDemande > PLAFOND_MAXIMUM) {
    erreurs.push({
      code: 'R1',
      champ: 'plafondDemande',
      message: `Le plafond demandé ne peut pas dépasser ${enDirhams(PLAFOND_MAXIMUM)}.`,
    });
  }

  // R2 : durée entière, de 1 à 7 jours.
  if (dureeJours === null) {
    erreurs.push({ code: 'R2', champ: 'dureeJours', message: 'La durée est obligatoire.' });
  } else if (
    !Number.isInteger(dureeJours) ||
    dureeJours < DUREE_MINIMUM_JOURS ||
    dureeJours > DUREE_MAXIMUM_JOURS
  ) {
    erreurs.push({
      code: 'R2',
      champ: 'dureeJours',
      message: `La durée doit être un nombre entier de jours, de ${DUREE_MINIMUM_JOURS} à ${DUREE_MAXIMUM_JOURS}.`,
    });
  }

  // R3 : motif obligatoire ; des espaces seuls ne comptent pas comme un motif.
  if (motif === null || motif.trim() === '') {
    erreurs.push({
      code: 'R3',
      champ: 'motif',
      message: 'Le motif de la demande est obligatoire.',
    });
  }

  // R4 : au-delà de 50 000 DH, un justificatif ; seule sa présence est contrôlée.
  if (plafondDemande !== null && plafondDemande > SEUIL_JUSTIFICATIF && !justificatifPresent) {
    erreurs.push({
      code: 'R4',
      champ: 'justificatif',
      message: `Au-delà de ${enDirhams(SEUIL_JUSTIFICATIF)}, un justificatif est obligatoire.`,
    });
  }

  // R5 : un dossier client incomplet empêche la soumission. Ne porte sur aucun champ :
  // ni le client ni l'agent ne peuvent modifier ce statut.
  if (!contexte.dossierComplet) {
    erreurs.push({
      code: 'R5',
      message:
        'Votre dossier client est incomplet : la demande ne peut pas être soumise. Contactez votre conseiller.',
    });
  }

  return erreurs;
}

// R8 : qui décide, selon le montant de la révision en cours (H4).
export type NiveauDeValidation = 'CONSEILLER' | 'SUPERVISEUR';

export function niveauDeValidation(plafondDemande: number): NiveauDeValidation {
  return plafondDemande <= SEUIL_DECISION_CONSEILLER ? 'CONSEILLER' : 'SUPERVISEUR';
}

// H12, H18 : un membre de la banque agit sur un dossier dans un rôle s'il a ce rôle ET si le
// dossier est dans le périmètre de ce rôle. Le conseiller : les dossiers dont il est le
// conseiller. Le superviseur : les dossiers de son équipe qui lui ont été transmis (recommandés).
export type MembreBanque = { id: string; roles: readonly string[]; teamId: string | null };
export type DossierBanque = {
  advisorId: string | null;
  teamId: string | null;
  recommenderId: string | null;
};

export function agitDansSonRole(
  role: NiveauDeValidation,
  membre: MembreBanque,
  dossier: DossierBanque,
): boolean {
  if (!membre.roles.includes(role)) {
    return false;
  }
  return role === 'CONSEILLER'
    ? dossier.advisorId === membre.id
    : dossier.teamId === membre.teamId && dossier.recommenderId !== null;
}

// Les décisions humaines.
export type TypeDecision = 'DEMANDE_COMPLEMENT' | 'APPROBATION' | 'REJET' | 'RECOMMANDATION';

export type Decision = {
  type: TypeDecision;
  // Le rôle sous lequel l'acteur décide, déduit par le serveur de l'action et de l'état (H18).
  role: 'CONSEILLER' | 'SUPERVISEUR';
  acteurId: string;
  motif: string | null;
};

export type DemandeADecider = {
  // Montant de la révision en cours (H4).
  plafondDemande: number;
  // Celui qui a recommandé la demande, s'il y en a un.
  recommenderId: string | null;
};

// Vérifie R8, R9 et R10 pour une décision. Renvoie la liste complète des erreurs.
// Les états de départ autorisés sont vérifiés par la table des transitions.
export function verifierDecision(decision: Decision, demande: DemandeADecider): ErreurRegle[] {
  const erreurs: ErreurRegle[] = [];
  const niveau = niveauDeValidation(demande.plafondDemande);
  const decideSeul = decision.type === 'APPROBATION' || decision.type === 'REJET';

  // R8 : au-delà de 30 000 DH, le conseiller ne peut ni approuver ni rejeter seul (H2)…
  if (decision.role === 'CONSEILLER' && decideSeul && niveau === 'SUPERVISEUR') {
    erreurs.push({
      code: 'R8',
      message: `Au-delà de ${enDirhams(SEUIL_DECISION_CONSEILLER)}, la décision revient au superviseur : transmettez une recommandation.`,
    });
  }
  // … et jusqu'à 30 000 DH, il décide lui-même : il n'y a rien à recommander.
  if (
    decision.role === 'CONSEILLER' &&
    decision.type === 'RECOMMANDATION' &&
    niveau === 'CONSEILLER'
  ) {
    erreurs.push({
      code: 'R8',
      message: `Jusqu'à ${enDirhams(SEUIL_DECISION_CONSEILLER)}, le conseiller décide lui-même : aucune recommandation n'est transmise.`,
    });
  }

  // R9 : celui qui a recommandé ne valide pas comme superviseur, même avec les deux rôles.
  if (decision.role === 'SUPERVISEUR' && decision.acteurId === demande.recommenderId) {
    erreurs.push({
      code: 'R9',
      message: 'Vous avez recommandé cette demande : un autre superviseur doit la valider.',
    });
  }

  // R10 : toute décision humaine comporte un motif.
  if (decision.motif === null || decision.motif.trim() === '') {
    erreurs.push({
      code: 'R10',
      champ: 'motif',
      message: 'Le motif de la décision est obligatoire.',
    });
  }

  return erreurs;
}
