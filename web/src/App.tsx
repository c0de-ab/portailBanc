import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { Connexion } from './pages/Connexion';
import { DetailDemande } from './pages/client/DetailDemande';
import { FormulaireDemande } from './pages/client/FormulaireDemande';
import { TableauDeBord } from './pages/client/TableauDeBord';
import { FournisseurSession, useSession } from './session';
import type { Role } from './types';

export function App() {
  return (
    <FournisseurSession>
      <BrowserRouter>
        <Routes>
          <Route path="/connexion" element={<Connexion />} />
          <Route path="/" element={<Accueil />} />
          <Route
            path="/client"
            element={
              <Protege role="CLIENT">
                <TableauDeBord />
              </Protege>
            }
          />
          <Route
            path="/client/comptes/:compteId/brouillon"
            element={
              <Protege role="CLIENT">
                <FormulaireDemande />
              </Protege>
            }
          />
          <Route
            path="/client/demandes/:id/completer"
            element={
              <Protege role="CLIENT">
                <FormulaireDemande />
              </Protege>
            }
          />
          <Route
            path="/client/demandes/:id"
            element={
              <Protege role="CLIENT">
                <DetailDemande />
              </Protege>
            }
          />
          <Route
            path="/banque"
            element={
              <Protege role="CONSEILLER">
                <EspaceBanque />
              </Protege>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </FournisseurSession>
  );
}

// Le rôle ne fait qu'orienter l'affichage : chaque route de l'API contrôle elle-même les droits.
function Accueil() {
  const { utilisateur, chargement } = useSession();
  if (chargement) {
    return null;
  }
  if (!utilisateur) {
    return <Navigate to="/connexion" replace />;
  }
  return <Navigate to={utilisateur.roles.includes('CLIENT') ? '/client' : '/banque'} replace />;
}

function Protege({ role, children }: { role: Role; children: ReactNode }) {
  const { utilisateur, chargement } = useSession();
  if (chargement) {
    return null;
  }
  if (!utilisateur) {
    return <Navigate to="/connexion" replace />;
  }
  // L'espace banque accueille conseillers et superviseurs.
  const autorise =
    role === 'CLIENT'
      ? utilisateur.roles.includes('CLIENT')
      : utilisateur.roles.some((r) => r === 'CONSEILLER' || r === 'SUPERVISEUR');
  if (!autorise) {
    return <Navigate to="/" replace />;
  }
  return <Cadre>{children}</Cadre>;
}

function Cadre({ children }: { children: ReactNode }) {
  const { utilisateur, deconnecter } = useSession();
  return (
    <>
      <header className="bandeau">
        <Link to="/" className="marque">
          Portail bancaire
        </Link>
        <span className="bandeau-utilisateur">{utilisateur?.displayName}</span>
        <button type="button" className="lien" onClick={() => void deconnecter()}>
          Se déconnecter
        </button>
      </header>
      <main className="page">{children}</main>
    </>
  );
}

// Écrans du conseiller et du superviseur : étape 8c.
function EspaceBanque() {
  return (
    <>
      <h1>Espace conseiller</h1>
      <p>Les écrans de traitement des dossiers arrivent à l’étape suivante.</p>
    </>
  );
}
