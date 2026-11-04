import type { Pool } from 'pg';
import { BanqueService, ErreurBanque, type ModeBanque } from '../src/banque/banque.service';
import { BaseService } from '../src/base/base.service';
import { executerTransaction } from '../src/base/transaction';
import { ActivationService } from '../src/demandes/activation.service';
import type { VueDossier } from '../src/demandes/demande';
import { creerComptesDemo } from '../src/demo/comptes-demo';
import { HistoriqueService } from '../src/historique/historique.service';
import { codesDe, demarrerAppTest } from './app-test';
import { parcours } from './parcours';
import { creerPoolTest, viderBase } from './outils-base';

// L'activation après l'approbation, et la reprise par « Relancer » (scénario 5), par les routes,
// sur la vraie base. Ce fichier a besoin de la route de démonstration : DEMO_MODE=true ici.

const AMAL = 'client.amal@portail.test';
const KARIM = 'conseiller.karim@portail.test';
const NADIA = 'conseiller.nadia@portail.test';
const OMAR = 'superviseur.omar@portail.test';

type ReponseDossier = { demande: VueDossier };

describe('Activation et reprise', () => {
  let pool: Pool;
  let appTest: Awaited<ReturnType<typeof demarrerAppTest>>;
  let p: ReturnType<typeof parcours>;
  const http = () => appTest.http();

  // Le mode de la banque, changé par la route de démonstration, comme pendant une démonstration.
  async function modeBanque(mode: ModeBanque) {
    const karim = await appTest.connecter(KARIM);
    const reponse = await http().post('/api/demo/banque/mode').set('Cookie', karim).send({ mode });
    expect(reponse.status).toBe(200);
  }

  // Amal soumet 25 000 DH, Karim approuve : la réponse indique le résultat de l'activation.
  async function approuverDemandeDAmal() {
    const demande = await p.demandeSoumise(await appTest.connecter(AMAL), 25_000);
    const karim = await appTest.connecter(KARIM);
    const reponse = await p.decider(karim, demande.id, 'approuver', demande.version, 'Conforme.');
    expect(reponse.status).toBe(200);
    return { karim, demande: (reponse.body as ReponseDossier).demande };
  }

  async function relancer(cookie: string, id: string) {
    return http().post(`/api/dossiers/${id}/relancer`).set('Cookie', cookie);
  }

  const operationsBancaires = async () =>
    (await pool.query('SELECT 1 FROM bank_operations')).rowCount;
  const plafondCourant = async () =>
    (
      await pool.query<{ plafond_courant: number }>(
        "SELECT plafond_courant FROM bank_limits WHERE numero = 'DEMO-0001'",
      )
    ).rows[0].plafond_courant;
  const evenements = async (id: string) =>
    (
      await pool.query<{ action: string }>(
        'SELECT action FROM events WHERE request_id = $1 ORDER BY id',
        [id],
      )
    ).rows.map((e) => e.action);

  beforeAll(async () => {
    process.env.DEMO_MODE = 'true';
    pool = creerPoolTest();
    appTest = await demarrerAppTest();
    p = parcours(http);
  });

  beforeEach(async () => {
    await viderBase(pool);
    await executerTransaction(pool, creerComptesDemo);
    appTest.app.get(BanqueService).changerMode('SUCCES');
  });

  afterAll(async () => {
    process.env.DEMO_MODE = 'false';
    await appTest.arreter();
    await pool.end();
  });

  describe('Scénario 1 : activation après l’approbation', () => {
    it('passe la demande à Active, avec la date de la banque et une échéance à 72 h (H8, H17)', async () => {
      const { demande } = await approuverDemandeDAmal();

      expect(demande).toMatchObject({ statut: 'ACTIVE', activationStatut: 'REUSSIE' });
      const debut = Date.parse(demande.dateActivation as unknown as string);
      const fin = Date.parse(demande.dateEcheance as unknown as string);
      expect(fin - debut).toBe(72 * 60 * 60 * 1000);
      expect(await plafondCourant()).toBe(25_000);

      const comptes = await http()
        .get('/api/comptes')
        .set('Cookie', await appTest.connecter(AMAL));
      expect((comptes.body as { comptes: unknown[] }).comptes[0]).toMatchObject({
        plafondCourant: 25_000,
        plafondTemporaireActif: true,
      });
      expect(await evenements(demande.id)).toEqual(
        expect.arrayContaining(['APPROBATION', 'ACTIVATION_REUSSIE']),
      );
    });
  });

  describe('Scénario 5 : échec, puis reprise', () => {
    it('la banque échoue : la demande reste Approuvée, état exact ; la relance aboutit une seule fois', async () => {
      await modeBanque('ECHEC');
      const { karim, demande } = await approuverDemandeDAmal();

      expect(demande).toMatchObject({ statut: 'APPROUVEE', activationStatut: 'ECHEC' });
      expect(demande.derniereErreur).toMatch(/refusé/);
      expect(await plafondCourant()).toBe(10_000);
      // Le client voit la différence entre la décision favorable et le plafond effectivement actif.
      const vueClient = await http()
        .get(`/api/demandes/${demande.id}`)
        .set('Cookie', await appTest.connecter(AMAL));
      expect((vueClient.body as { demande: object }).demande).toMatchObject({
        statut: 'APPROUVEE',
        activationStatut: 'ECHEC',
      });

      await modeBanque('SUCCES');
      const reprise = await relancer(karim, demande.id);

      expect(reprise.status).toBe(200);
      expect((reprise.body as ReponseDossier).demande).toMatchObject({
        statut: 'ACTIVE',
        activationStatut: 'REUSSIE',
        derniereErreur: null,
      });
      expect(await operationsBancaires()).toBe(1);
      expect(await evenements(demande.id)).toEqual(
        expect.arrayContaining(['ACTIVATION_ECHEC', 'RELANCE', 'ACTIVATION_REUSSIE']),
      );
    });

    it('la réponse est perdue : état inconnu ; la relance retrouve le résultat sans réappliquer', async () => {
      await modeBanque('REPONSE_PERDUE');
      const { karim, demande } = await approuverDemandeDAmal();

      expect(demande).toMatchObject({ statut: 'APPROUVEE', activationStatut: 'INCONNU' });
      // La banque a bel et bien appliqué le plafond.
      expect(await plafondCourant()).toBe(25_000);
      const appliqueLe = (
        await pool.query<{ resultat: { appliqueLe: string } }>(
          'SELECT resultat FROM bank_operations',
        )
      ).rows[0].resultat.appliqueLe;

      // Même sans revenir au mode SUCCES : une clé connue renvoie son résultat (H16).
      const reprise = await relancer(karim, demande.id);

      const active = (reprise.body as ReponseDossier).demande;
      expect(active).toMatchObject({ statut: 'ACTIVE', activationStatut: 'REUSSIE' });
      expect(new Date(active.dateActivation as unknown as string)).toEqual(new Date(appliqueLe));
      expect(await operationsBancaires()).toBe(1);
    });

    it('deux relances simultanées n’activent qu’une fois', async () => {
      await modeBanque('ECHEC');
      const { karim, demande } = await approuverDemandeDAmal();
      await modeBanque('SUCCES');

      const reponses = await Promise.all([
        relancer(karim, demande.id),
        relancer(karim, demande.id),
      ]);

      // L'ordre d'arrivée dépend de la machine : une relance qui charge le dossier APRÈS la fin de
      // l'autre le trouve déjà Active, et la table des transitions la refuse (409 R13). Les deux
      // issues sont correctes ; ce qui ne dépend jamais du timing, c'est l'activation unique.
      for (const reponse of reponses) {
        if (reponse.status === 200) {
          expect((reponse.body as ReponseDossier).demande.statut).toBe('ACTIVE');
        } else {
          expect(reponse.status).toBe(409);
          expect(codesDe(reponse)).toEqual(['R13']);
        }
      }
      expect(reponses.some((r) => r.status === 200)).toBe(true);
      expect(await operationsBancaires()).toBe(1);
      expect((await evenements(demande.id)).filter((e) => e === 'ACTIVATION_REUSSIE')).toHaveLength(
        1,
      );
    });

    it('une relance arrivée après l’activation est refusée (409 R13), sans rien rejouer', async () => {
      await modeBanque('ECHEC');
      const { karim, demande } = await approuverDemandeDAmal();
      await modeBanque('SUCCES');
      await relancer(karim, demande.id);

      const tardive = await relancer(karim, demande.id);

      expect(tardive.status).toBe(409);
      expect(codesDe(tardive)).toEqual(['R13']);
      expect(await operationsBancaires()).toBe(1);
    });

    it('un échec arrivé en retard n’écrase jamais une activation réussie entre-temps', async () => {
      await modeBanque('ECHEC');
      const { demande } = await approuverDemandeDAmal();
      // Une banque qui répond en retard : pendant l'appel, une autre reprise a activé la demande.
      const banqueEnRetard = {
        appliquer: async () => {
          await pool.query(
            "UPDATE requests SET statut = 'ACTIVE', activation_statut = 'REUSSIE' WHERE id = $1",
            [demande.id],
          );
          throw new ErreurBanque('DELAI', 'Délai dépassé.');
        },
      } as unknown as BanqueService;
      const base = appTest.app.get(BaseService);
      const activation = new ActivationService(base, new HistoriqueService(base), banqueEnRetard);

      const resultat = await activation.activer(demande.id, new Date());

      expect(resultat).toMatchObject({ statut: 'ACTIVE', activationStatut: 'REUSSIE' });
      expect(await evenements(demande.id)).not.toContain('ACTIVATION_INCONNUE');
    });
  });

  describe('Refus de la relance', () => {
    it('refuse une relance hors de l’état Approuvée (409 R13)', async () => {
      const demande = await p.demandeSoumise(await appTest.connecter(AMAL), 25_000);

      const reponse = await relancer(await appTest.connecter(KARIM), demande.id);

      expect(reponse.status).toBe(409);
      expect(codesDe(reponse)).toEqual(['R13']);
    });

    it('refuse une relance hors périmètre (404), par un client (403) ou par un superviseur non concerné (404)', async () => {
      await modeBanque('ECHEC');
      const { demande } = await approuverDemandeDAmal();
      const nadia = await appTest.connecter(NADIA);
      const amal = await appTest.connecter(AMAL);
      const omar = await appTest.connecter(OMAR);

      expect((await relancer(nadia, demande.id)).status).toBe(404);
      expect((await relancer(amal, demande.id)).status).toBe(403);
      // Décidé par Karim seul (25 000 DH) : jamais transmis, donc invisible pour le superviseur.
      expect((await relancer(omar, demande.id)).status).toBe(404);
    });
  });

  describe('Route de démonstration', () => {
    it('n’existe pas sans DEMO_MODE=true (404), et est réservée au personnel (403)', async () => {
      const karim = await appTest.connecter(KARIM);
      const amal = await appTest.connecter(AMAL);

      process.env.DEMO_MODE = 'false';
      const horsDemo = await http()
        .post('/api/demo/banque/mode')
        .set('Cookie', karim)
        .send({ mode: 'ECHEC' });
      process.env.DEMO_MODE = 'true';
      const parUnClient = await http()
        .post('/api/demo/banque/mode')
        .set('Cookie', amal)
        .send({ mode: 'ECHEC' });
      const modeInvalide = await http()
        .post('/api/demo/banque/mode')
        .set('Cookie', karim)
        .send({ mode: 'PANNE' });

      expect(horsDemo.status).toBe(404);
      expect(codesDe(horsDemo)).toEqual(['INTROUVABLE']);
      expect(parUnClient.status).toBe(403);
      expect(modeInvalide.status).toBe(400);
      expect(appTest.app.get(BanqueService).lireMode()).toBe('SUCCES');
    });
  });
});
