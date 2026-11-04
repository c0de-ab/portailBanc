import type { Pool } from 'pg';
import { BanqueService } from '../src/banque/banque.service';
import { executerTransaction } from '../src/base/transaction';
import type { VueDossier } from '../src/demandes/demande';
import { ExpirationService } from '../src/demandes/expiration.service';
import { creerComptesDemo } from '../src/demo/comptes-demo';
import { demarrerAppTest } from './app-test';
import { parcours } from './parcours';
import { creerPoolTest, viderBase } from './outils-base';

// L'expiration des plafonds temporaires (H6, H22), sur la vraie base : une demande rendue Active
// par le vrai parcours, puis le service appelé par la commande `npm run expire`.

const AMAL = 'client.amal@portail.test';
const KARIM = 'conseiller.karim@portail.test';
const UNE_HEURE = 60 * 60 * 1000;

type ReponseDossier = { demande: VueDossier };

describe('Expiration', () => {
  let pool: Pool;
  let appTest: Awaited<ReturnType<typeof demarrerAppTest>>;
  let p: ReturnType<typeof parcours>;
  let expiration: ExpirationService;
  let banque: BanqueService;
  const http = () => appTest.http();

  // Amal : 25 000 DH pour 3 jours, approuvée par Karim, activée par la banque.
  async function demandeActive(): Promise<VueDossier & { echeance: Date }> {
    const demande = await p.demandeSoumise(await appTest.connecter(AMAL), 25_000);
    const karim = await appTest.connecter(KARIM);
    const reponse = await p.decider(karim, demande.id, 'approuver', demande.version, 'Conforme.');
    const active = (reponse.body as ReponseDossier).demande;
    expect(active.statut).toBe('ACTIVE');
    return { ...active, echeance: new Date(active.dateEcheance as unknown as string) };
  }

  const etat = async (id: string) =>
    (
      await pool.query<{ statut: string; desactivation_statut: string | null }>(
        'SELECT statut, desactivation_statut FROM requests WHERE id = $1',
        [id],
      )
    ).rows[0];
  const plafondCourant = async () =>
    (
      await pool.query<{ plafond_courant: number }>(
        "SELECT plafond_courant FROM bank_limits WHERE numero = 'DEMO-0001'",
      )
    ).rows[0].plafond_courant;
  const desactivations = async () =>
    (await pool.query("SELECT 1 FROM bank_operations WHERE cle LIKE 'desact-%'")).rowCount;

  beforeAll(async () => {
    pool = creerPoolTest();
    appTest = await demarrerAppTest();
    p = parcours(http);
    expiration = appTest.app.get(ExpirationService);
    banque = appTest.app.get(BanqueService);
  });

  beforeEach(async () => {
    await viderBase(pool);
    await executerTransaction(pool, creerComptesDemo);
    banque.changerMode('SUCCES');
  });

  afterAll(async () => {
    await appTest.arreter();
    await pool.end();
  });

  describe('Scénario 1 : expiration simulée', () => {
    it('ne touche à rien avant l’échéance', async () => {
      const active = await demandeActive();

      const bilan = await expiration.expirer(
        new Date(active.echeance.getTime() - 60_000),
        new Date(),
      );

      expect(bilan).toEqual({ expirees: 0, enEchec: 0 });
      expect(await etat(active.id)).toEqual({ statut: 'ACTIVE', desactivation_statut: null });
    });

    it('après l’échéance : Expirée, plafond initial rétabli, événement daté de l’heure réelle (H22)', async () => {
      const active = await demandeActive();
      const dateSimulee = new Date(active.echeance.getTime() + UNE_HEURE);
      const avant = Date.now();

      const bilan = await expiration.expirer(dateSimulee, new Date());

      expect(bilan).toEqual({ expirees: 1, enEchec: 0 });
      expect(await etat(active.id)).toEqual({ statut: 'EXPIREE', desactivation_statut: 'REUSSIE' });
      expect(await plafondCourant()).toBe(10_000);
      const { rows } = await pool.query<{ created_at: Date; details: { dateSimulee: string } }>(
        "SELECT created_at, details FROM events WHERE request_id = $1 AND action = 'EXPIRATION'",
        [active.id],
      );
      expect(rows).toHaveLength(1);
      // L'heure réelle, et non la date simulée (trois jours plus tard) : l'historique reste chronologique.
      expect(rows[0].created_at.getTime()).toBeGreaterThanOrEqual(avant - 1000);
      expect(rows[0].created_at.getTime()).toBeLessThan(dateSimulee.getTime());
      expect(rows[0].details.dateSimulee).toBe(dateSimulee.toISOString());
    });

    it('un second passage ne fait rien', async () => {
      const active = await demandeActive();
      const dateSimulee = new Date(active.echeance.getTime() + UNE_HEURE);
      await expiration.expirer(dateSimulee, new Date());

      const bilan = await expiration.expirer(dateSimulee, new Date());

      expect(bilan).toEqual({ expirees: 0, enEchec: 0 });
      expect(await desactivations()).toBe(1);
    });

    it('après l’expiration, le compte peut recevoir une nouvelle demande (R6 libéré)', async () => {
      const active = await demandeActive();
      await expiration.expirer(new Date(active.echeance.getTime() + UNE_HEURE), new Date());

      const nouvelle = await p.demandeSoumise(await appTest.connecter(AMAL), 20_000);

      expect(nouvelle.statut).toBe('SOUMISE');
    });
  });

  describe('Désactivation en échec, puis reprise', () => {
    it('ECHEC : la demande reste Active, puis le passage suivant l’expire, avec une seule opération', async () => {
      const active = await demandeActive();
      const dateSimulee = new Date(active.echeance.getTime() + UNE_HEURE);

      banque.changerMode('ECHEC');
      const premier = await expiration.expirer(dateSimulee, new Date());
      expect(premier).toEqual({ expirees: 0, enEchec: 1 });
      expect(await etat(active.id)).toEqual({ statut: 'ACTIVE', desactivation_statut: 'ECHEC' });
      expect(await plafondCourant()).toBe(25_000);

      banque.changerMode('SUCCES');
      const second = await expiration.expirer(dateSimulee, new Date());

      expect(second).toEqual({ expirees: 1, enEchec: 0 });
      expect(await etat(active.id)).toEqual({ statut: 'EXPIREE', desactivation_statut: 'REUSSIE' });
      expect(await desactivations()).toBe(1);
    });

    it('réponse perdue : Active et INCONNU alors que la banque a rétabli le plafond ; la reprise ne réapplique rien', async () => {
      const active = await demandeActive();
      const dateSimulee = new Date(active.echeance.getTime() + UNE_HEURE);

      banque.changerMode('REPONSE_PERDUE');
      await expiration.expirer(dateSimulee, new Date());
      expect(await etat(active.id)).toEqual({ statut: 'ACTIVE', desactivation_statut: 'INCONNU' });
      expect(await plafondCourant()).toBe(10_000);

      // Même en mode ECHEC : une clé connue renvoie son résultat (H16).
      banque.changerMode('ECHEC');
      const reprise = await expiration.expirer(dateSimulee, new Date());

      expect(reprise).toEqual({ expirees: 1, enEchec: 0 });
      expect(await etat(active.id)).toMatchObject({ statut: 'EXPIREE' });
      expect(await desactivations()).toBe(1);
    });
  });

  it('seules les demandes Actives échues sont concernées', async () => {
    const active = await demandeActive();
    // Une autre demande, seulement soumise, sur un autre compte.
    const soumise = await p.demandeSoumise(
      await appTest.connecter('client.youssef@portail.test'),
      20_000,
    );

    const bilan = await expiration.expirer(
      new Date(active.echeance.getTime() + UNE_HEURE),
      new Date(),
    );

    expect(bilan).toEqual({ expirees: 1, enEchec: 0 });
    expect((await etat(soumise.id)).statut).toBe('SOUMISE');
  });
});
