import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ErreurApi } from '../api';
import { useSession } from '../session';

// Page d'accueil : le coffre occupe tout l'écran, le formulaire est au centre.
export function Connexion() {
  const { utilisateur, connecter } = useSession();
  const naviguer = useNavigate();
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Le mot de passe peut être affiché en clair, le temps de vérifier sa saisie.
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);

  if (utilisateur) {
    return <Navigate to="/" replace />;
  }

  async function envoyer(evenement: FormEvent) {
    evenement.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      await connecter(email, motDePasse);
      naviguer('/', { replace: true });
    } catch (e) {
      // Même message pour un e-mail inconnu et un mauvais mot de passe : celui du serveur.
      setErreur(e instanceof ErreurApi ? e.message : 'Connexion impossible pour le moment.');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <main className="coffre coffre-connexion">
      <p className="marque connexion-marque">Portail bancaire</p>

      <form className="panel connexion-carte" onSubmit={envoyer}>
        <h1 className="h1 centre marge-bas-8">Connexion</h1>
        <div className="champ">
          <label className="etiquette" htmlFor="connexion-email">
            Adresse e-mail
          </label>
          <input
            id="connexion-email"
            className="saisie"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="champ">
          <label className="etiquette" htmlFor="connexion-mdp">
            Mot de passe
          </label>
          <div className="saisie-mdp">
            <input
              id="connexion-mdp"
              className="saisie"
              type={motDePasseVisible ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
            />
            <button
              type="button"
              className="saisie-mdp-bouton"
              aria-controls="connexion-mdp"
              aria-pressed={motDePasseVisible}
              aria-label={
                motDePasseVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
              }
              title={motDePasseVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              onClick={() => setMotDePasseVisible((v) => !v)}
            >
              {motDePasseVisible ? ICONE_MASQUER : ICONE_AFFICHER}
            </button>
          </div>
        </div>
        {erreur && (
          <p className="message message-erreur" role="alert">
            {erreur}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-primaire btn-plein connexion-bouton"
          disabled={envoi}
        >
          {envoi ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  );
}

// L'oeil (afficher) et l'oeil barré (masquer), dessinés au trait, décoratifs : le nom du
// bouton est porté par aria-label.
const ICONE_AFFICHER = (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <path
      d="M1.75 10s3-5.75 8.25-5.75S18.25 10 18.25 10 15.25 15.75 10 15.75 1.75 10 1.75 10z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="10" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
const ICONE_MASQUER = (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <path
      d="M1.75 10s3-5.75 8.25-5.75S18.25 10 18.25 10 15.25 15.75 10 15.75 1.75 10 1.75 10z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="10" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M3 17 17 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
