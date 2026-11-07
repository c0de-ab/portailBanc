import type {
  Compte,
  Demande,
  DetailDemande,
  DetailDossier,
  Dossier,
  ElementAgent,
  ModeBanque,
  ErreurDetaillee,
  Utilisateur,
} from './types';

// Tous les appels à l'API passent par ici. URL relatives : même origine en production,
// redirection par Vite en développement. Le cookie de session suit tout seul (même origine).

// Une réponse en erreur, au format { erreurs } de l'API.
export class ErreurApi extends Error {
  constructor(
    readonly statut: number,
    readonly erreurs: ErreurDetaillee[],
  ) {
    super(erreurs.map((e) => e.message).join(' '));
  }

  // Un conflit (R7, R11…) : la demande a changé, il faut la relire.
  get estUnConflit(): boolean {
    return this.statut === 409;
  }
}

// Session expirée ou absente : l'application revient à la page de connexion.
export const EVENEMENT_SESSION_EXPIREE = 'portail:session-expiree';

async function appeler<T>(methode: string, chemin: string, corps?: unknown): Promise<T> {
  const estFormulaire = corps instanceof FormData;
  const reponse = await fetch(`/api${chemin}`, {
    method: methode,
    headers:
      corps === undefined || estFormulaire ? undefined : { 'Content-Type': 'application/json' },
    body: corps === undefined ? undefined : estFormulaire ? corps : JSON.stringify(corps),
  });
  if (reponse.status === 204) {
    return undefined as T;
  }
  const contenu = (await reponse.json().catch(() => null)) as {
    erreurs?: ErreurDetaillee[];
  } | null;
  if (!reponse.ok) {
    if (reponse.status === 401 && chemin !== '/auth/connexion') {
      window.dispatchEvent(new Event(EVENEMENT_SESSION_EXPIREE));
    }
    throw new ErreurApi(
      reponse.status,
      contenu?.erreurs ?? [{ code: 'INCONNUE', message: 'Le serveur ne répond pas correctement.' }],
    );
  }
  return contenu as T;
}

export type AvecAvertissements = { demande: Demande; avertissements: ErreurDetaillee[] };

export const api = {
  // Authentification
  connexion: (email: string, motDePasse: string) =>
    appeler<{ utilisateur: Utilisateur }>('POST', '/auth/connexion', { email, motDePasse }),
  deconnexion: () => appeler<void>('POST', '/auth/deconnexion'),
  moi: () => appeler<{ utilisateur: Utilisateur }>('GET', '/auth/moi'),

  // Parcours du client
  comptes: () => appeler<{ comptes: Compte[] }>('GET', '/comptes'),
  demandes: () => appeler<{ demandes: Demande[] }>('GET', '/demandes'),
  demande: (id: string) => appeler<DetailDemande>('GET', `/demandes/${id}`),
  obtenirBrouillon: (compteId: string) =>
    appeler<AvecAvertissements>('POST', `/comptes/${compteId}/brouillon`),
  modifier: (
    d: Demande,
    contenu: { plafondDemande?: number | null; dureeJours?: number | null; motif?: string | null },
  ) =>
    appeler<AvecAvertissements>('PATCH', `/demandes/${d.id}`, { version: d.version, ...contenu }),
  deposerJustificatif: (d: Demande, fichier: File) => {
    const formulaire = new FormData();
    formulaire.append('version', String(d.version));
    formulaire.append('fichier', fichier);
    return appeler<AvecAvertissements>('PUT', `/demandes/${d.id}/justificatif`, formulaire);
  },
  // R7 : le client renvoie exactement ce qu'il a vu, avec la version (non affichée).
  soumettre: (d: { id: string; version: number; plafondDemande: number; dureeJours: number }) =>
    appeler<{ demande: Demande }>('POST', `/demandes/${d.id}/soumettre`, {
      version: d.version,
      plafondDemande: d.plafondDemande,
      dureeJours: d.dureeJours,
    }),
  annuler: (d: Demande) =>
    appeler<{ demande: Demande }>('POST', `/demandes/${d.id}/annuler`, { version: d.version }),
  abandonner: (d: Demande) =>
    appeler<{ demande: Demande }>('POST', `/demandes/${d.id}/abandonner`, { version: d.version }),
  lienJustificatif: (id: string) => `/api/demandes/${id}/justificatif`,

  // L'agent : le message du client est une donnée, l'agent ne soumet jamais. 503 si le modèle
  // est indisponible (IA_INDISPONIBLE) : les formulaires restent utilisables.
  envoyerMessage: (message: string) =>
    appeler<{ elements: ElementAgent[] }>('POST', '/agent/messages', { message }),
  // Efface aussi la mémoire gardée par le serveur dans la session.
  effacerConversation: () => appeler<void>('DELETE', '/agent/conversation'),

  // Personnel de la banque. Le périmètre est filtré par le serveur (R14) ; chaque décision
  // renvoie la version lue (R11) et un motif (R10).
  dossiers: () => appeler<{ dossiers: Dossier[] }>('GET', '/dossiers'),
  dossier: (id: string) => appeler<DetailDossier>('GET', `/dossiers/${id}`),
  decider: (d: Dossier, action: 'demander-complement' | 'approuver' | 'rejeter', motif: string) =>
    appeler<{ demande: Dossier }>('POST', `/dossiers/${d.id}/${action}`, {
      version: d.version,
      motif,
    }),
  recommander: (d: Dossier, avis: 'FAVORABLE' | 'DEFAVORABLE', motif: string) =>
    appeler<{ demande: Dossier }>('POST', `/dossiers/${d.id}/recommander`, {
      version: d.version,
      motif,
      avis,
    }),
  // Sans version (H15) : la relance ne prend aucune décision.
  relancer: (d: Dossier) => appeler<{ demande: Dossier }>('POST', `/dossiers/${d.id}/relancer`),
  lienJustificatifDossier: (id: string) => `/api/dossiers/${id}/justificatif`,

  // Démonstration seulement (DEMO_MODE=true) : sinon la route répond 404.
  modeBanque: () => appeler<{ mode: ModeBanque }>('GET', '/demo/banque/mode'),
  changerModeBanque: (mode: ModeBanque) =>
    appeler<{ mode: ModeBanque }>('POST', '/demo/banque/mode', { mode }),
};
