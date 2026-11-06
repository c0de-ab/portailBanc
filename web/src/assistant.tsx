import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { api, ErreurApi } from './api';
import { useSession } from './session';
import type { ElementAgent } from './types';

// La conversation avec l'assistant, gardée ici plutôt que dans le panneau : elle reste affichée
// quand le client change de page. Le serveur garde de son côté le contexte de la conversation
// dans la session ; rien n'est enregistré durablement.

export type Echange =
  | { de: 'client'; texte: string }
  | { de: 'agent'; elements: ElementAgent[] }
  | { de: 'indisponible'; texte: string };

type EtatAssistant = {
  ouvert: boolean;
  ouvrir: (question?: string) => void;
  fermer: () => void;
  basculer: () => void;
  effacer: () => Promise<void>;
  echanges: Echange[];
  envoi: boolean;
  message: string;
  setMessage: (message: string) => void;
  envoyer: (texte: string) => Promise<void>;
  // Augmente quand l'assistant ou la carte de confirmation a modifié une demande : la page
  // affichée sous le panneau est alors rechargée, pour montrer l'état réel.
  versionDonnees: number;
  donneesModifiees: () => void;
};

const ContexteAssistant = createContext<EtatAssistant | null>(null);

export function FournisseurAssistant({ children }: { children: ReactNode }) {
  const { utilisateur } = useSession();
  const [ouvert, setOuvert] = useState(false);
  const [echanges, setEchanges] = useState<Echange[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState('');
  const [versionDonnees, setVersionDonnees] = useState(0);
  // L'élément qui a ouvert le panneau : il reprend le focus à la fermeture.
  const declencheur = useRef<HTMLElement | null>(null);

  // Un autre utilisateur, ou une déconnexion : on repart d'une conversation vide. La
  // comparaison se fait pendant le rendu, comme le recommande React pour remettre un état à zéro.
  const idUtilisateur = utilisateur?.id;
  const [idPrecedent, setIdPrecedent] = useState(idUtilisateur);
  if (idUtilisateur !== idPrecedent) {
    setIdPrecedent(idUtilisateur);
    setOuvert(false);
    setEchanges([]);
    setMessage('');
  }

  const ouvrir = useCallback((question?: string) => {
    if (document.activeElement instanceof HTMLElement) {
      declencheur.current = document.activeElement;
    }
    // Une question proposée arrive déjà saisie ; le client l'envoie lui-même.
    if (question) {
      setMessage(question);
    }
    setOuvert(true);
  }, []);

  const fermer = useCallback(() => {
    setOuvert(false);
    // Après le nouvel affichage : le bouton qui a ouvert le panneau est peut-être encore masqué.
    setTimeout(() => declencheur.current?.focus());
  }, []);

  // Le raccourci clavier et le bouton du menu ouvrent ou masquent le panneau.
  const basculer = useCallback(() => {
    if (ouvert) {
      fermer();
    } else {
      ouvrir();
    }
  }, [ouvert, ouvrir, fermer]);

  // Efface l'écran ET la mémoire du serveur : l'assistant repart vraiment de zéro.
  const effacer = useCallback(async () => {
    try {
      await api.effacerConversation();
      setEchanges([]);
    } catch {
      setEchanges((x) => [
        ...x,
        { de: 'indisponible', texte: 'La conversation n’a pas pu être effacée. Réessayez.' },
      ]);
    }
  }, []);

  const donneesModifiees = useCallback(() => setVersionDonnees((v) => v + 1), []);

  const envoyer = useCallback(
    async (texte: string) => {
      const propre = texte.trim();
      if (propre === '' || envoi) {
        return;
      }
      setEchanges((e) => [...e, { de: 'client', texte: propre }]);
      setMessage('');
      setEnvoi(true);
      try {
        const { elements } = await api.envoyerMessage(propre);
        setEchanges((e) => [...e, { de: 'agent', elements }]);
        // Une action réalisée (brouillon enregistré) change les données de la page.
        if (elements.some((element) => element.type === 'action')) {
          donneesModifiees();
        }
      } catch (e) {
        const texteErreur =
          e instanceof ErreurApi && e.statut === 503
            ? 'L’assistant est indisponible pour le moment. Vous pouvez faire votre demande avec le formulaire, qui reste utilisable.'
            : e instanceof ErreurApi
              ? e.message
              : 'Le serveur est injoignable.';
        setEchanges((x) => [...x, { de: 'indisponible', texte: texteErreur }]);
      } finally {
        setEnvoi(false);
      }
    },
    [envoi, donneesModifiees],
  );

  return (
    <ContexteAssistant.Provider
      value={{
        ouvert,
        ouvrir,
        fermer,
        basculer,
        effacer,
        echanges,
        envoi,
        message,
        setMessage,
        envoyer,
        versionDonnees,
        donneesModifiees,
      }}
    >
      {children}
    </ContexteAssistant.Provider>
  );
}

export function useAssistant(): EtatAssistant {
  const assistant = useContext(ContexteAssistant);
  if (!assistant) {
    throw new Error('useAssistant doit être utilisé dans FournisseurAssistant');
  }
  return assistant;
}
