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
          <input
            id="connexion-mdp"
            className="saisie"
            type="password"
            autoComplete="current-password"
            required
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
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
