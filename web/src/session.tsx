import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, EVENEMENT_SESSION_EXPIREE } from './api';
import type { Utilisateur } from './types';

// L'utilisateur connecté, tel que le serveur le connaît (GET /api/auth/moi). L'interface ne
// décide d'aucun droit : elle n'adapte que l'affichage, le serveur contrôle tout.
type Session = {
  utilisateur: Utilisateur | null;
  chargement: boolean;
  connecter: (email: string, motDePasse: string) => Promise<Utilisateur>;
  deconnecter: () => Promise<void>;
};

const ContexteSession = createContext<Session | null>(null);

export function FournisseurSession({ children }: { children: ReactNode }) {
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    api
      .moi()
      .then(({ utilisateur }) => setUtilisateur(utilisateur))
      .catch(() => setUtilisateur(null))
      .finally(() => setChargement(false));
    // Une session expirée en cours de route renvoie à la connexion.
    const expiree = () => setUtilisateur(null);
    window.addEventListener(EVENEMENT_SESSION_EXPIREE, expiree);
    return () => window.removeEventListener(EVENEMENT_SESSION_EXPIREE, expiree);
  }, []);

  const connecter = useCallback(async (email: string, motDePasse: string) => {
    const { utilisateur } = await api.connexion(email, motDePasse);
    setUtilisateur(utilisateur);
    return utilisateur;
  }, []);

  const deconnecter = useCallback(async () => {
    await api.deconnexion();
    setUtilisateur(null);
  }, []);

  return (
    <ContexteSession.Provider value={{ utilisateur, chargement, connecter, deconnecter }}>
      {children}
    </ContexteSession.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(ContexteSession);
  if (!session) {
    throw new Error('useSession doit être utilisé dans FournisseurSession');
  }
  return session;
}
