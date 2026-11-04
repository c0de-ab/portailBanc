import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ErreurApi } from '../api';
import { useSession } from '../session';

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
    <main className="page page-connexion">
      <h1>Portail bancaire</h1>
      <p className="chapeau">Connectez-vous pour suivre vos plafonds de virement.</p>
      <form onSubmit={envoyer} className="formulaire">
        <label>
          Adresse e-mail
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            autoComplete="current-password"
            required
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
        </label>
        {erreur && (
          <p className="message message-erreur" role="alert">
            {erreur}
          </p>
        )}
        <button type="submit" className="bouton" disabled={envoi}>
          {envoi ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  );
}
