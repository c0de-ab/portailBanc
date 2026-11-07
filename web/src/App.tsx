import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes } from 'react-router';
import { ErreurAffichage } from './erreur-affichage';
import { Connexion } from './pages/Connexion';
import { DetailDossier } from './pages/banque/DetailDossier';
import { ListeDossiers } from './pages/banque/ListeDossiers';
import { DetailDemande } from './pages/client/DetailDemande';
import { FormulaireDemande } from './pages/client/FormulaireDemande';
import { IndicateurBanqueDemo } from './pages/banque/ModeBanqueDemo';
import { PanneauAssistant } from './pages/client/PanneauAssistant';
import { TableauDeBord } from './pages/client/TableauDeBord';
import { FournisseurAssistant, useAssistant } from './assistant';
import { FournisseurSession, useSession } from './session';
import { libelleRole, type Role } from './types';

export function App() {
  return (
    <ErreurAffichage>
      <FournisseurSession>
        <FournisseurAssistant>
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
              {/* L'ancienne adresse de l'assistant ouvre le panneau sur « Mes plafonds ». */}
              <Route
                path="/client/assistant"
                element={
                  <Protege role="CLIENT">
                    <OuvrirAssistant />
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
        </FournisseurAssistant>
      </FournisseurSession>
    </ErreurAffichage>
  );
}

// Le rôle ne fait qu'orienter l'affichage : chaque route de l'API contrôle elle-même les droits.
function Accueil() {
  const { utilisateur, chargement } = useSession();
  if (chargement) {
    return <ChargementSession />;
  }
  if (!utilisateur) {
    return <Navigate to="/connexion" replace />;
  }
  return <Navigate to={utilisateur.roles.includes('CLIENT') ? '/client' : '/banque'} replace />;
}

function OuvrirAssistant() {
  const { ouvrir } = useAssistant();
  useEffect(() => ouvrir(), [ouvrir]);
  return <Navigate to="/client" replace />;
}

// Le temps de demander au serveur qui est connecté : un texte, plutôt qu'un écran vide.
function ChargementSession() {
  return (
    <p className="chargement chargement-session" role="status">
      Chargement…
    </p>
  );
}

function Protege({ role, children }: { role: Role; children: ReactNode }) {
  const { utilisateur, chargement } = useSession();
  if (chargement) {
    return <ChargementSession />;
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

// Le raccourci qui ouvre ou masque l'assistant, affiché sur le bouton flottant.
const RACCOURCI = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘ K' : 'Ctrl K';

function Cadre({ children }: { children: ReactNode }) {
  const { utilisateur, deconnecter } = useSession();
  const assistant = useAssistant();
  const { basculer } = assistant;
  const roles = utilisateur?.roles ?? [];
  const client = roles.includes('CLIENT');

  // Ctrl K (⌘ K sur Mac) ouvre ou masque l'assistant, depuis n'importe quelle page client.
  useEffect(() => {
    if (!client) {
      return;
    }
    const touche = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        basculer();
      }
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [client, basculer]);

  const espace = client
    ? 'Espace client'
    : roles.includes('SUPERVISEUR') && !roles.includes('CONSEILLER')
      ? 'Espace superviseur'
      : 'Espace conseiller';
  return (
    <div className={client && assistant.ouvert ? 'shell avec-assistant' : 'shell'}>
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
              {/* « Mes plafonds » couvre tout l'espace client : tableau de bord, formulaire, détail. */}
              <NavLink to="/client" className="rail-lien">
                {ICONE_PLAFONDS}
                Mes plafonds
              </NavLink>
              {/* L'assistant s'ouvre à côté de la page en cours, sans la quitter. */}
              <button
                type="button"
                className="rail-lien"
                aria-expanded={assistant.ouvert}
                aria-controls="panneau-assistant"
                onClick={basculer}
              >
                {ICONE_ASSISTANT}
                Assistant
              </button>
            </>
          ) : (
            <NavLink to="/banque" className="rail-lien">
              {ICONE_DOSSIERS}
              Dossiers
            </NavLink>
          )}
        </nav>
        {/* En bas de la barre latérale, qui reste fixe quand la page défile : toujours visible. */}
        <div className="rail-pied">
          {/* Le mode de la banque simulée, global : visible sur toutes les pages de la banque. */}
          {!client && <IndicateurBanqueDemo />}
          <div className="qui">
            <span className="avatar" aria-hidden="true">
              {utilisateur?.displayName.charAt(0)}
            </span>
            <span className="qui-texte">
              <span className="qui-nom">{utilisateur?.displayName}</span>
              <span className="qui-detail">{libelleRole(roles)}</span>
            </span>
          </div>
          <button type="button" className="rail-deconnexion" onClick={() => void deconnecter()}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <div className="zone">
        {/* Quand l'assistant a modifié une demande, la clé change : la page est rechargée et
            montre l'état réel. */}
        <main className="contenu" key={assistant.versionDonnees}>
          {children}
        </main>
      </div>
      {client && <PanneauAssistant />}
      {/* Le bouton flottant reste à portée, en haut comme en bas de la page. */}
      {/* Masqué, et non retiré, quand le panneau est ouvert : il reprend le focus à la fermeture. */}
      {client && (
        <button
          type="button"
          className="lanceur-assistant"
          aria-controls="panneau-assistant"
          aria-expanded={assistant.ouvert}
          hidden={assistant.ouvert}
          onClick={() => assistant.ouvrir()}
        >
          {ICONE_ASSISTANT}
          Assistant
          <kbd>{RACCOURCI}</kbd>
        </button>
      )}
    </div>
  );
}
