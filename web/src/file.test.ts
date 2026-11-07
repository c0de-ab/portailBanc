import { describe, expect, it } from 'vitest';
import { creerFile } from './file';

describe('creerFile : la file des enregistrements du formulaire', () => {
  it('exécute les tâches dans l’ordre, chacune après la fin de la précédente', async () => {
    const ajouter = creerFile();
    const ordre: string[] = [];
    const lente = () =>
      new Promise<void>((resoudre) =>
        setTimeout(() => {
          ordre.push('lente');
          resoudre();
        }, 20),
      );
    const rapide = () => {
      ordre.push('rapide');
      return Promise.resolve();
    };

    await Promise.all([ajouter(lente), ajouter(rapide)]);

    expect(ordre).toEqual(['lente', 'rapide']);
  });

  it('une tâche en échec ne bloque pas les suivantes, et son échec est rendu à son auteur', async () => {
    const ajouter = creerFile();

    const echec = ajouter(() => Promise.reject(new Error('réseau coupé')));
    const suivante = ajouter(() => Promise.resolve('enregistré'));

    await expect(echec).rejects.toThrow('réseau coupé');
    await expect(suivante).resolves.toBe('enregistré');
  });
});
