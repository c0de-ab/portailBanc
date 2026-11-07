import type { Pool } from 'pg';
import { BanqueService, ErreurBanque } from '../src/banque/banque.service';
import { BaseService } from '../src/base/base.service';
import { creerPoolTest, viderBase } from './outils-base';

// La banque simulée seule, sur la vraie base portail_test.
describe('Banque simulée', () => {
  let pool: Pool;
  let base: BaseService;
  let banque: BanqueService;
  const MAINTENANT = new Date('2026-11-04T10:00:00Z');
  const PLUS_TARD = new Date('2026-11-04T11:00:00Z');

  const plafondCourant = async () =>
    (
      await pool.query<{ plafond_courant: number }>(
        "SELECT plafond_courant FROM bank_limits WHERE numero = 'B-0001'",
      )
    ).rows[0].plafond_courant;
  const operations = async () => (await pool.query('SELECT 1 FROM bank_operations')).rowCount;

  beforeAll(() => {
    pool = creerPoolTest();
    base = new BaseService();
  });

  beforeEach(async () => {
    await viderBase(pool);
    await pool.query("INSERT INTO bank_limits (numero, plafond_courant) VALUES ('B-0001', 10000)");
    banque = new BanqueService(base);
  });

  afterAll(async () => {
    await base.onModuleDestroy();
    await pool.end();
  });

  it('SUCCES : applique le plafond et renvoie la date d’application (H17)', async () => {
    const resultat = await banque.appliquer('act-1', 'B-0001', 'ACTIVER', 25_000, MAINTENANT);

    expect(resultat).toEqual({
      operation: 'ACTIVER',
      plafondApplique: 25_000,
      appliqueLe: MAINTENANT,
    });
    expect(await plafondCourant()).toBe(25_000);
    expect(await operations()).toBe(1);
  });

  it('une clé déjà connue renvoie le résultat d’origine, sans rien appliquer à nouveau', async () => {
    await banque.appliquer('act-1', 'B-0001', 'ACTIVER', 25_000, MAINTENANT);
    await pool.query("UPDATE bank_limits SET plafond_courant = 10000 WHERE numero = 'B-0001'");

    const reprise = await banque.appliquer('act-1', 'B-0001', 'ACTIVER', 25_000, PLUS_TARD);

    expect(reprise.appliqueLe).toEqual(MAINTENANT);
    expect(await plafondCourant()).toBe(10_000);
    expect(await operations()).toBe(1);
  });

  it('ECHEC : n’écrit rien et renvoie une erreur ; la reprise appliquera l’opération', async () => {
    banque.changerMode('ECHEC');

    await expect(
      banque.appliquer('act-1', 'B-0001', 'ACTIVER', 25_000, MAINTENANT),
    ).rejects.toMatchObject({ nature: 'ECHEC' });
    expect(await operations()).toBe(0);
    expect(await plafondCourant()).toBe(10_000);

    banque.changerMode('SUCCES');
    await banque.appliquer('act-1', 'B-0001', 'ACTIVER', 25_000, PLUS_TARD);
    expect(await plafondCourant()).toBe(25_000);
  });

  it('REPONSE_PERDUE : l’opération est validée, mais l’appelant reçoit un délai dépassé', async () => {
    banque.changerMode('REPONSE_PERDUE');

    const appel = banque.appliquer('act-1', 'B-0001', 'ACTIVER', 25_000, MAINTENANT);

    await expect(appel).rejects.toBeInstanceOf(ErreurBanque);
    await expect(appel).rejects.toMatchObject({ nature: 'DELAI' });
    expect(await plafondCourant()).toBe(25_000);
    expect(await operations()).toBe(1);
  });

  it('H16 : après une réponse perdue, la reprise retrouve le résultat, même en mode ECHEC', async () => {
    banque.changerMode('REPONSE_PERDUE');
    await banque.appliquer('act-1', 'B-0001', 'ACTIVER', 25_000, MAINTENANT).catch(() => undefined);

    banque.changerMode('ECHEC');
    const reprise = await banque.appliquer('act-1', 'B-0001', 'ACTIVER', 25_000, PLUS_TARD);

    expect(reprise).toEqual({
      operation: 'ACTIVER',
      plafondApplique: 25_000,
      appliqueLe: MAINTENANT,
    });
    expect(await operations()).toBe(1);
  });

  it('deux appels simultanés avec la même clé n’appliquent l’opération qu’une fois', async () => {
    const [a, b] = await Promise.all([
      banque.appliquer('act-1', 'B-0001', 'ACTIVER', 25_000, MAINTENANT),
      banque.appliquer('act-1', 'B-0001', 'ACTIVER', 25_000, MAINTENANT),
    ]);

    expect(a).toEqual(b);
    expect(await operations()).toBe(1);
  });

  it('refuse un compte inconnu de la banque, sans rien enregistrer', async () => {
    await expect(
      banque.appliquer('act-1', 'INCONNU', 'ACTIVER', 25_000, MAINTENANT),
    ).rejects.toMatchObject({ nature: 'ECHEC' });
    expect(await operations()).toBe(0);
  });
});
