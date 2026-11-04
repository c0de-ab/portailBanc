import { AsyncLocalStorage } from 'node:async_hooks';

// Le contexte « via l'agent » : tout ce qu'un outil de l'agent fait passer par les services
// métier (brouillon, modification, refus…) est tracé avec via_agent = true, sans ajouter un
// paramètre à chaque méthode de ces services. On lit alors « Amal, via l'agent ».
const contexte = new AsyncLocalStorage<{ viaAgent: true }>();

// Exécute `travail` pour le compte de l'agent : les événements écrits pendant cet appel, même
// dans des fonctions asynchrones appelées plus loin, portent via_agent = true.
export function pourLAgent<T>(travail: () => Promise<T>): Promise<T> {
  return contexte.run({ viaAgent: true }, travail);
}

export function estPourLAgent(): boolean {
  return contexte.getStore()?.viaAgent === true;
}
