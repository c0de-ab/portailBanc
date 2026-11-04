import type { StatutExecution } from '../demandes/demande';
import { ErreurBanque } from './banque.service';

// Ce que l'application fait de chaque appel à la banque simulée, à l'activation comme à
// l'expiration : la même limite de temps, la même lecture des erreurs.

// Délai maximal d'un appel à la banque (CLAUDE.md, règle 7).
const DELAI_BANQUE_MS = 3000;

// L'appel, borné à 3 s : au-delà, le résultat est inconnu (comme une réponse perdue).
export async function avecDelai<T>(appel: Promise<T>): Promise<T> {
  let minuteur: NodeJS.Timeout | undefined;
  const delai = new Promise<never>((_resoudre, rejeter) => {
    minuteur = setTimeout(
      () => rejeter(new ErreurBanque('DELAI', 'Délai dépassé : la banque n’a pas répondu en 3 s.')),
      DELAI_BANQUE_MS,
    );
  });
  try {
    return await Promise.race([appel, delai]);
  } finally {
    clearTimeout(minuteur);
  }
}

// ECHEC : la banque a refusé, rien n'est appliqué. Sinon (délai, erreur inattendue) : on ne sait
// pas ce qui s'est passé côté banque ; le résultat est INCONNU et la reprise le retrouvera.
export function decrireEchec(erreur: unknown): { statut: StatutExecution; message: string } {
  if (erreur instanceof ErreurBanque) {
    return { statut: erreur.nature === 'ECHEC' ? 'ECHEC' : 'INCONNU', message: erreur.message };
  }
  return { statut: 'INCONNU', message: 'Erreur inattendue lors de l’appel à la banque.' };
}
