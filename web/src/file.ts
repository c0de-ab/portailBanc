// Une file d'écritures : chaque tâche démarre après la fin de la précédente, dans l'ordre
// d'arrivée. Le formulaire s'en sert pour que chaque enregistrement parte de la version renvoyée
// par le précédent (R11). Une tâche en échec ne bloque JAMAIS les suivantes : l'échec est rendu
// à celui qui l'a ajoutée, et la file continue.
export type File = <T>(tache: () => Promise<T>) => Promise<T>;

export function creerFile(): File {
  let precedente: Promise<unknown> = Promise.resolve();
  return <T>(tache: () => Promise<T>): Promise<T> => {
    const resultat = precedente.then(tache);
    precedente = resultat.catch(() => undefined);
    return resultat;
  };
}
