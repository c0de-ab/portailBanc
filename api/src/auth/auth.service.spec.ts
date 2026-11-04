import * as argon2 from 'argon2';
import type { BaseService } from '../base/base.service';
import { AuthService } from './auth.service';

// argon2.verify est espionné, mais garde son vrai comportement.
jest.mock('argon2', () => {
  const reel = jest.requireActual<typeof import('argon2')>('argon2');
  return { ...reel, verify: jest.fn(reel.verify) };
});

// Test unitaire, sans base : la table users est simulée par un double de BaseService.
describe('AuthService : même travail pour un e-mail inconnu', () => {
  it('vérifie quand même le mot de passe contre le hachage factice', async () => {
    const base = {
      // Aucun utilisateur trouvé ; l'insertion de l'événement réussit.
      requete: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as unknown as BaseService;
    const service = new AuthService(base);
    await service.onModuleInit();
    jest.mocked(argon2.verify).mockClear();

    const resultat = await service.verifierIdentifiants(
      'inconnu@portail.test',
      'un-mot-de-passe',
      new Date('2026-11-04T10:00:00Z'),
    );

    expect(resultat).toBeNull();
    // Une vérification Argon2 a bien eu lieu, sur un hachage Argon2id : le temps de réponse
    // ne révèle pas que l'e-mail est inconnu.
    expect(argon2.verify).toHaveBeenCalledTimes(1);
    expect(jest.mocked(argon2.verify).mock.calls[0][0]).toMatch(/^\$argon2id\$/);
    expect(jest.mocked(argon2.verify).mock.calls[0][1]).toBe('un-mot-de-passe');
  });
});
