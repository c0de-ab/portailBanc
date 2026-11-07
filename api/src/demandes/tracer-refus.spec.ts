import { Logger } from '@nestjs/common';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import type { HistoriqueService } from '../historique/historique.service';
import { ErreurApi } from '../http/erreur-api';
import { tracerLesRefus } from './tracer-refus';

const CLIENT = { id: 'amal' } as UtilisateurSession;
const MAINTENANT = new Date('2026-11-05T10:00:00Z');
const REFUS_404 = new ErreurApi(404, [{ code: 'R14', message: 'Demande introuvable.' }]);

function historique(ecrire: jest.Mock): HistoriqueService {
  return { ecrire } as unknown as HistoriqueService;
}

describe('tracerLesRefus (règle 11)', () => {
  it('trace le refus, puis relance la même erreur', async () => {
    const ecrire = jest.fn().mockResolvedValue(undefined);

    await expect(
      tracerLesRefus(historique(ecrire), CLIENT, 'consulter', 'x', MAINTENANT, () =>
        Promise.reject(REFUS_404),
      ),
    ).rejects.toBe(REFUS_404);
    expect(ecrire).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REFUS',
        details: expect.objectContaining({ codes: ['R14'] }) as unknown,
      }),
    );
  });

  it('si le traçage échoue, le client reçoit quand même l’erreur d’origine, pas un 500', async () => {
    const ecrire = jest.fn().mockRejectedValue(new Error('base indisponible'));
    const journal = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    try {
      await expect(
        tracerLesRefus(historique(ecrire), CLIENT, 'consulter', 'x', MAINTENANT, () =>
          Promise.reject(REFUS_404),
        ),
      ).rejects.toBe(REFUS_404);
      expect(journal).toHaveBeenCalled();
    } finally {
      journal.mockRestore();
    }
  });

  it('une erreur inattendue n’est pas tracée comme un refus', async () => {
    const ecrire = jest.fn();
    const panne = new Error('panne');

    await expect(
      tracerLesRefus(historique(ecrire), CLIENT, 'consulter', 'x', MAINTENANT, () =>
        Promise.reject(panne),
      ),
    ).rejects.toBe(panne);
    expect(ecrire).not.toHaveBeenCalled();
  });
});
