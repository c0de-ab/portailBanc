import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { Connexion } from './pages/Connexion';
import { DetailDossier } from './pages/banque/DetailDossier';
import { ListeDossiers } from './pages/banque/ListeDossiers';
import { Assistant } from './pages/client/Assistant';
import { DetailDemande } from './pages/client/DetailDemande';
import { FormulaireDemande } from './pages/client/FormulaireDemande';
import { TableauDeBord } from './pages/client/TableauDeBord';
import { FournisseurSession, useSession } from './session';
import { libelleRole, type Role } from './types';

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
            path="/client/assistant"
            element={
              <Protege role="CLIENT">
                <Assistant />
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
                <ListeDossiers />
              </Protege>
            }
          />
          <Route
            path="/banque/dossiers/:id"
            element={
              <Protege role="CONSEILLER">
                <DetailDossier />
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

// Les pictogrammes du menu, dessinés au trait, décoratifs.
const ICONE_PLAFONDS = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path
      d="M2.5 13a6.5 6.5 0 0 1 13 0M9 13l3-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);
const ICONE_ASSISTANT = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path
      d="M3 4h12v8.5H7.5L3 15.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);
const ICONE_DOSSIERS = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path
      d="M2.5 5.5h4l1.5 1.5h7.5v7.5h-13z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

function Cadre({ children }: { children: ReactNode }) {
  const { utilisateur, deconnecter } = useSession();
  const { pathname } = useLocation();
  const roles = utilisateur?.roles ?? [];
  const client = roles.includes('CLIENT');
  // Le lien actif porte aria-current="page", que la feuille de style met en valeur.
  // « Mes plafonds » couvre tout l'espace client (formulaire, détail), sauf l'assistant.
  const assistant = pathname.startsWith('/client/assistant');
  const actif = (oui: boolean) => (oui ? ('page' as const) : undefined);
  const espace = client
    ? 'Espace client'
    : roles.includes('SUPERVISEUR') && !roles.includes('CONSEILLER')
      ? 'Espace superviseur'
      : 'Espace conseiller';
  return (
    <div className="shell">
      <aside className="rail" aria-label="Menu">
        <div className="rail-marque">
          <Link to="/" className="marque">
            Portail bancaire
          </Link>
          <span className="rail-role">{espace}</span>
        </div>
        <nav className="rail-nav" aria-label="Navigation principale">
          {client ? (
            <>
              <Link to="/client" className="rail-lien" aria-current={actif(!assistant)}>
                {ICONE_PLAFONDS}
                Mes plafonds
              </Link>
              <Link to="/client/assistant" className="rail-lien" aria-current={actif(assistant)}>
                {ICONE_ASSISTANT}
                Assistant
              </Link>
            </>
          ) : (
            <Link to="/banque" className="rail-lien" aria-current="page">
              {ICONE_DOSSIERS}
              Dossiers
            </Link>
          )}
        </nav>
      </aside>
      <div className="zone">
        {/* L'utilisateur connecté et la déconnexion, en haut à droite. */}
        <header className="barre-haut">
          <div className="qui">
            <span className="avatar" aria-hidden="true">
              {utilisateur?.displayName.charAt(0)}
            </span>
            <span className="qui-texte">
              <span className="qui-nom">{utilisateur?.displayName}</span>
              <span className="qui-detail">{libelleRole(roles)}</span>
            </span>
          </div>
          <button type="button" className="btn btn-secondaire" onClick={() => void deconnecter()}>
            Se déconnecter
          </button>
        </header>
        <main className="contenu">{children}</main>
      </div>
    </div>
  );
}
