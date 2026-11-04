import { ErreurApi } from './api';
import type { ErreurDetaillee } from './types';

// Les erreurs d'une action, au format de l'API, affichées comme du texte.
export function ListeErreurs({ erreurs }: { erreurs: ErreurDetaillee[] }) {
  if (erreurs.length === 0) {
    return null;
  }
  return (
    <div className="message message-erreur" role="alert">
      <ul>
        {erreurs.map((e, i) => (
          <li key={i}>{e.message}</li>
        ))}
      </ul>
    </div>
  );
}

// Les erreurs à afficher pour une exception : celles de l'API, ou un message générique.
export function erreursDe(e: unknown, message = 'Le serveur est injoignable.'): ErreurDetaillee[] {
  return e instanceof ErreurApi ? e.erreurs : [{ code: 'INCONNUE', message }];
}
