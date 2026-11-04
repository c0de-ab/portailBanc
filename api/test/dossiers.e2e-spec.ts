import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { BaseService } from '../src/base/base.service';
import { executerTransaction } from '../src/base/transaction';
import type { VueDemandeClient, VueDossier } from '../src/demandes/demande';
import { creerComptesDemo } from '../src/demo/comptes-demo';
import { creerDemandesDemo } from '../src/demo/demandes-demo';
import { codesDe, demarrerAppTest } from './app-test';
import { parcours } from './parcours';
import { creerPoolTest, viderBase } from './outils-base';

// Le traitement des dossiers par le conseiller et le superviseur, par les routes, sur la vraie
// base et avec les comptes de démonstration (docs/modele-donnees.md, § 7).

const AMAL = 'client.amal@portail.test';
const YOUSSEF = 'client.youssef@portail.test';
const HAMID = 'client.hamid@portail.test';
const MEHDI = 'client.mehdi@portail.test';
const KARIM = 'conseiller.karim@portail.test';
const NADIA = 'conseiller.nadia@portail.test';
const OMAR = 'superviseur.omar@portail.test';
const RACHID = 'superviseur.rachid@portail.test';
const LEILA = 'mixte.leila@portail.test';

type ReponseDossier = { demande: VueDossier };

describe('Traitement des dossiers', () => {
  let pool: Pool;
  let dossierJustificatifs: string;
  let appTest: Awaited<ReturnType<typeof demarrerAppTest>>;
  let p: ReturnType<typeof parcours>;
  const http = () => appTest.http();

  async function listeDe(email: string): Promise<VueDossier[]> {
    // Le cookie d'abord : une requête supertest ne doit pas être créée avant un autre appel.
    const cookie = await appTest.connecter(email);
    const reponse = await http().get('/api/dossiers').set('Cookie', cookie);
    return (reponse.body as { dossiers: VueDossier[] }).dossiers;
  }

  async function demandeDe(email: string, plafondDemande: number) {
    return p.demandeSoumise(await appTest.connecter(email), plafondDemande);
  }

  beforeAll(async () => {
    dossierJustificatifs = mkdtempSync(join(tmpdir(), 'portail-justificatifs-'));
    process.env.UPLOADS_DIR = dossierJustificatifs;
    pool = creerPoolTest();
    appTest = await demarrerAppTest();
    p = parcours(http);
  });

  beforeEach(async () => {
    await viderBase(pool);
    await executerTransaction(pool, creerComptesDemo);
  });

  afterAll(async () => {
    await appTest.arreter();
    await pool.end();
    rmSync(dossierJustificatifs, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  describe('Périmètres (R14)', () => {
    beforeEach(async () => {
      await demandeDe(AMAL, 25_000); // Karim
      await demandeDe(YOUSSEF, 35_000); // Nadia
      await creerDemandesDemo(appTest.app.get(BaseService), new Date()); // Mehdi (Karim), Inès (équipe B)
    });

    it('un conseiller ne voit que son portefeuille, sans aucun brouillon', async () => {
      const karim = await listeDe(KARIM);
      const nadia = await listeDe(NADIA);

      expect(karim.map((d) => d.plafondDemande).sort()).toEqual([25_000, 40_000]);
      expect(nadia.map((d) => d.plafondDemande)).toEqual([35_000]);
      expect(karim.every((d) => d.statut !== 'BROUILLON')).toBe(true);
    });

    it('un superviseur ne voit que les dossiers transmis à son équipe', async () => {
      expect(await listeDe(OMAR)).toEqual([]);
      expect((await listeDe(RACHID)).map((d) => d.plafondDemande)).toEqual([45_000]);
    });

    it('Omar reçoit 404 sur le dossier d’Inès, transmis à l’équipe B, et le refus est tracé', async () => {
      const [ines] = await listeDe(RACHID);
      const omar = await appTest.connecter(OMAR);

      const reponse = await http().get(`/api/dossiers/${ines.id}`).set('Cookie', omar);

      expect(reponse.status).toBe(404);
      expect(codesDe(reponse)).toEqual(['R14']);
      const refus = await pool.query(
        `SELECT 1 FROM events e JOIN users u ON u.id = e.actor_id
          WHERE e.action = 'REFUS' AND u.email = $1`,
        [OMAR],
      );
      expect(refus.rowCount).toBe(1);
    });

    it('un client n’a pas accès aux routes du personnel (403 ROLE)', async () => {
      const amal = await appTest.connecter(AMAL);

      const reponse = await http().get('/api/dossiers').set('Cookie', amal);

      expect(reponse.status).toBe(403);
      expect(codesDe(reponse)).toEqual(['ROLE']);
    });
  });

  describe('Scénario 1 : approbation par le conseiller', () => {
    it('Karim approuve 25 000 DH : Approuvée, activation en attente, décision et événement', async () => {
      const demande = await demandeDe(AMAL, 25_000);
      const karim = await appTest.connecter(KARIM);

      const reponse = await p.decider(
        karim,
        demande.id,
        'approuver',
        demande.version,
        'Dossier conforme.',
      );

      expect(reponse.status).toBe(200);
      expect((reponse.body as ReponseDossier).demande).toMatchObject({
        statut: 'APPROUVEE',
        activationStatut: 'EN_ATTENTE',
        version: demande.version + 1,
      });
      const detail = await p.dossier(karim, demande.id);
      expect(detail.decisions).toEqual([
        expect.objectContaining({ type: 'APPROBATION', role: 'CONSEILLER', acteur: 'Karim' }),
      ]);
      expect(detail.historique.map((e) => e.action)).toContain('APPROBATION');
    });
  });

  describe('Scénario 2 : complément, recommandation et décision du superviseur', () => {
    it('va de la demande de complément jusqu’à l’approbation par un autre acteur superviseur', async () => {
      const youssef = await appTest.connecter(YOUSSEF);
      const nadia = await appTest.connecter(NADIA);
      const omar = await appTest.connecter(OMAR);
      const soumise = await p.demandeSoumise(youssef, 60_000);

      // 1. Nadia demande un complément motivé.
      const complement = await p.decider(
        nadia,
        soumise.id,
        'demander-complement',
        soumise.version,
        'Merci de préciser l’usage des fonds.',
      );
      expect((complement.body as ReponseDossier).demande.statut).toBe('COMPLEMENT_DEMANDE');

      // 2. Youssef voit le motif, complète et resoumet : même référence, révision v2.
      const vue = await http().get(`/api/demandes/${soumise.id}`).set('Cookie', youssef);
      const corps = vue.body as {
        demande: VueDemandeClient;
        decisions: { type: string; motif: string }[];
      };
      expect(corps.decisions).toEqual([
        expect.objectContaining({
          type: 'DEMANDE_COMPLEMENT',
          motif: 'Merci de préciser l’usage des fonds.',
        }),
      ]);
      const modifiee = await http()
        .patch(`/api/demandes/${soumise.id}`)
        .set('Cookie', youssef)
        .send({
          version: corps.demande.version,
          motif: 'Achat d’un véhicule utilitaire pour mon activité',
        });
      const resoumise = await p.soumettre(
        youssef,
        (modifiee.body as { demande: VueDemandeClient }).demande,
      );
      expect(resoumise).toMatchObject({
        statut: 'SOUMISE',
        reference: soumise.reference,
        revisionCourante: 2,
      });

      // 3. Nadia ne peut pas décider seule au-delà de 30 000 DH : elle recommande.
      const seule = await p.decider(nadia, soumise.id, 'approuver', resoumise.version);
      expect(seule.status).toBe(403);
      expect(codesDe(seule)).toEqual(['R8']);
      const recommandee = await p.decider(
        nadia,
        soumise.id,
        'recommander',
        resoumise.version,
        'Avis favorable.',
      );
      expect((recommandee.body as ReponseDossier).demande.statut).toBe('ATTENTE_SUPERVISEUR');

      // 4. Omar, un autre acteur, superviseur de l'équipe, approuve.
      const version = (recommandee.body as ReponseDossier).demande.version;
      const approuvee = await p.decider(omar, soumise.id, 'approuver', version, 'Accord.');
      expect((approuvee.body as ReponseDossier).demande).toMatchObject({
        statut: 'APPROUVEE',
        activationStatut: 'EN_ATTENTE',
      });

      // Le personnel voit tout ; le client ne voit jamais la recommandation (H19).
      const detail = await p.dossier(omar, soumise.id);
      expect(detail.decisions.map((d) => [d.type, d.role])).toEqual([
        ['DEMANDE_COMPLEMENT', 'CONSEILLER'],
        ['RECOMMANDATION_FAVORABLE', 'CONSEILLER'],
        ['APPROBATION', 'SUPERVISEUR'],
      ]);
      expect(detail.revisions.map((r) => r.revisionNo)).toEqual([1, 2]);
      const vueClient = await http().get(`/api/demandes/${soumise.id}`).set('Cookie', youssef);
      expect(
        (vueClient.body as { decisions: { type: string }[] }).decisions.map((d) => d.type),
      ).toEqual(['DEMANDE_COMPLEMENT', 'APPROBATION']);
      expect(vueClient.text).not.toMatch(/RECOMMANDATION|Avis favorable|recommenderId/);
    });
  });

  describe('Scénario 3 et R9 : contournements refusés par le serveur', () => {
    it('Karim ne peut pas approuver les 40 000 DH de Mehdi (403 R8), et le refus est tracé', async () => {
      await creerDemandesDemo(appTest.app.get(BaseService), new Date());
      const karim = await appTest.connecter(KARIM);
      const mehdi = (await listeDe(KARIM)).find((d) => d.plafondDemande === 40_000)!;

      const reponse = await p.decider(karim, mehdi.id, 'approuver', mehdi.version);

      expect(reponse.status).toBe(403);
      expect(codesDe(reponse)).toEqual(['R8']);
      const enBase = await pool.query<{ statut: string }>(
        'SELECT statut FROM requests WHERE id = $1',
        [mehdi.id],
      );
      expect(enBase.rows[0].statut).toBe('SOUMISE');
      const refus = await pool.query<{ codes: string[] }>(
        `SELECT e.details->'codes' AS codes FROM events e JOIN users u ON u.id = e.actor_id
          WHERE e.action = 'REFUS' AND u.email = $1`,
        [KARIM],
      );
      expect(refus.rows).toEqual([{ codes: ['R8'] }]);
    });

    it('Leila recommande la demande de Hamid, puis ne peut pas la valider elle-même (403 R9)', async () => {
      const demande = await demandeDe(HAMID, 35_000);
      const leila = await appTest.connecter(LEILA);
      const recommandee = await p.decider(leila, demande.id, 'recommander', demande.version);
      const version = (recommandee.body as ReponseDossier).demande.version;

      const parLeila = await p.decider(leila, demande.id, 'approuver', version);
      const parOmar = await p.decider(
        await appTest.connecter(OMAR),
        demande.id,
        'approuver',
        version,
      );

      expect(parLeila.status).toBe(403);
      expect(codesDe(parLeila)).toEqual(['R9']);
      expect(parOmar.status).toBe(200);
    });

    it('un conseiller ne décide pas sur un dossier transmis au superviseur (403 ROLE)', async () => {
      const demande = await demandeDe(MEHDI, 40_000);
      const karim = await appTest.connecter(KARIM);
      const recommandee = await p.decider(karim, demande.id, 'recommander', demande.version);

      const reponse = await p.decider(
        karim,
        demande.id,
        'approuver',
        (recommandee.body as ReponseDossier).demande.version,
      );

      expect(reponse.status).toBe(403);
      expect(codesDe(reponse)).toEqual(['ROLE']);
    });

    it('un superviseur ne demande pas de complément (H5 : TRANSITION)', async () => {
      const demande = await demandeDe(MEHDI, 40_000);
      const recommandee = await p.decider(
        await appTest.connecter(KARIM),
        demande.id,
        'recommander',
        demande.version,
      );

      const reponse = await p.decider(
        await appTest.connecter(OMAR),
        demande.id,
        'demander-complement',
        (recommandee.body as ReponseDossier).demande.version,
      );

      expect(reponse.status).toBe(409);
      expect(codesDe(reponse)).toEqual(['TRANSITION']);
    });

    it('refuse une recommandation à 30 000 DH ou moins (403 R8) et une décision sans motif (422 R10)', async () => {
      const demande = await demandeDe(AMAL, 30_000);
      const karim = await appTest.connecter(KARIM);

      const recommandation = await p.decider(karim, demande.id, 'recommander', demande.version);
      const sansMotif = await p.decider(karim, demande.id, 'rejeter', demande.version, '   ');

      expect(recommandation.status).toBe(403);
      expect(codesDe(recommandation)).toEqual(['R8']);
      expect(sansMotif.status).toBe(422);
      expect(codesDe(sansMotif)).toEqual(['R10']);
    });
  });

  describe('Scénario 4 : deux décisions sur la même version', () => {
    it('ne produisent pas de résultats contradictoires : une réussit, l’autre reçoit 409', async () => {
      const demande = await demandeDe(AMAL, 25_000);
      const karim = await appTest.connecter(KARIM);

      const [approbation, rejet] = await Promise.all([
        p.decider(karim, demande.id, 'approuver', demande.version),
        p.decider(karim, demande.id, 'rejeter', demande.version),
      ]);

      expect([approbation.status, rejet.status].sort()).toEqual([200, 409]);
      const decisions = await pool.query('SELECT 1 FROM decisions WHERE request_id = $1', [
        demande.id,
      ]);
      expect(decisions.rowCount).toBe(1);
    });

    it('une décision fondée sur une version périmée est refusée (R11)', async () => {
      const demande = await demandeDe(AMAL, 25_000);
      const karim = await appTest.connecter(KARIM);
      await p.decider(karim, demande.id, 'demander-complement', demande.version);

      const reponse = await p.decider(karim, demande.id, 'approuver', demande.version);

      expect(reponse.status).toBe(409);
      expect(codesDe(reponse)).toEqual(['R11']);
    });
  });

  describe('Annulation pendant l’attente du superviseur (H3)', () => {
    it('le client peut encore annuler une demande recommandée', async () => {
      const mehdi = await appTest.connecter(MEHDI);
      const demande = await p.demandeSoumise(mehdi, 40_000);
      const recommandee = await p.decider(
        await appTest.connecter(KARIM),
        demande.id,
        'recommander',
        demande.version,
      );

      const reponse = await http()
        .post(`/api/demandes/${demande.id}/annuler`)
        .set('Cookie', mehdi)
        .send({ version: (recommandee.body as ReponseDossier).demande.version });

      expect(reponse.status).toBe(200);
      expect((reponse.body as { demande: VueDemandeClient }).demande.statut).toBe('ANNULEE');
    });
  });

  describe('Justificatif et demandes de démonstration', () => {
    it('le conseiller télécharge le justificatif d’un dossier de son portefeuille', async () => {
      const demande = await demandeDe(YOUSSEF, 60_000);
      const nadia = await appTest.connecter(NADIA);
      const karim = await appTest.connecter(KARIM);

      const reponse = await http()
        .get(`/api/dossiers/${demande.id}/justificatif`)
        .set('Cookie', nadia);
      const horsPerimetre = await http()
        .get(`/api/dossiers/${demande.id}/justificatif`)
        .set('Cookie', karim);

      expect(reponse.status).toBe(200);
      expect(reponse.headers['content-disposition']).toMatch(/^attachment;/);
      expect(horsPerimetre.status).toBe(404);
    });

    it('le seed crée les demandes de Mehdi et d’Inès par les services, une seule fois', async () => {
      const base = appTest.app.get(BaseService);

      const premier = await creerDemandesDemo(base, new Date());
      const second = await creerDemandesDemo(base, new Date());

      expect(premier).toHaveLength(2);
      expect(second).toEqual([]);
      const { rows } = await pool.query<{
        client: string;
        statut: string;
        recommandeur: string | null;
      }>(
        `SELECT cu.email AS client, r.statut, ru.email AS recommandeur
           FROM requests r
           JOIN clients c ON c.id = r.client_id JOIN users cu ON cu.id = c.user_id
           LEFT JOIN users ru ON ru.id = r.recommender_id
          ORDER BY cu.email`,
      );
      expect(rows).toEqual([
        {
          client: 'client.ines@portail.test',
          statut: 'ATTENTE_SUPERVISEUR',
          recommandeur: 'conseiller.salma@portail.test',
        },
        { client: MEHDI, statut: 'SOUMISE', recommandeur: null },
      ]);
      // Le vrai parcours : l'historique d'Inès est celui d'une demande de l'application.
      const evenements = await pool.query<{ action: string }>(
        `SELECT e.action FROM events e JOIN requests r ON r.id = e.request_id
           JOIN clients c ON c.id = r.client_id JOIN users u ON u.id = c.user_id
          WHERE u.email = 'client.ines@portail.test' ORDER BY e.id`,
      );
      expect(evenements.rows.map((e) => e.action)).toEqual([
        'BROUILLON_CREE',
        'MODIFICATION',
        'SOUMISSION',
        'RECOMMANDATION_FAVORABLE',
      ]);
    });
  });
});
