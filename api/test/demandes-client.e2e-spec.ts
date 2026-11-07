import type { Pool } from 'pg';
import { executerTransaction } from '../src/base/transaction';
import type { VueDemandeClient } from '../src/demandes/demande';
import * as accesClient from '../src/demandes/acces-client';
import { creerComptesDemo } from '../src/demo/comptes-demo';
import { codesDe, demarrerAppTest, erreursDe } from './app-test';
import { creerPoolTest, viderBase } from './outils-base';

// Le parcours du client, par les routes, sur la vraie base portail_test et avec les comptes
// de démonstration.

const AMAL = 'client.amal@portail.test';
const YOUSSEF = 'client.youssef@portail.test';
const SARA = 'client.sara@portail.test';
const KARIM = 'conseiller.karim@portail.test';

type Avertissement = { code: string; champ?: string; message: string };
type ReponseDemande = { demande: VueDemandeClient; avertissements?: Avertissement[] };

describe('Parcours du client', () => {
  let pool: Pool;
  let appTest: Awaited<ReturnType<typeof demarrerAppTest>>;
  const http = () => appTest.http();

  // --- Petites actions du client, par les vraies routes --------------------------------

  async function compteDe(cookie: string): Promise<string> {
    const reponse = await http().get('/api/comptes').set('Cookie', cookie);
    return (reponse.body as { comptes: { id: string }[] }).comptes[0].id;
  }

  async function brouillon(cookie: string) {
    const compteId = await compteDe(cookie);
    return http().post(`/api/comptes/${compteId}/brouillon`).set('Cookie', cookie);
  }

  function modifier(cookie: string, demande: VueDemandeClient, contenu: object) {
    return http()
      .patch(`/api/demandes/${demande.id}`)
      .set('Cookie', cookie)
      .send({ version: demande.version, ...contenu });
  }

  // Le client confirme ce qu'il voit : la version, le montant et la durée de la demande.
  function soumettre(cookie: string, demande: VueDemandeClient, ecart: object = {}) {
    return http()
      .post(`/api/demandes/${demande.id}/soumettre`)
      .set('Cookie', cookie)
      .send({
        version: demande.version,
        plafondDemande: demande.plafondDemande,
        dureeJours: demande.dureeJours,
        ...ecart,
      });
  }

  // Un brouillon rempli, prêt à être soumis.
  async function brouillonRempli(cookie: string, plafondDemande: number, dureeJours = 3) {
    const cree = (await brouillon(cookie)).body as ReponseDemande;
    const reponse = await modifier(cookie, cree.demande, {
      plafondDemande,
      dureeJours,
      motif: 'Achat d’un véhicule',
    });
    return reponse.body as ReponseDemande;
  }

  async function lireDemande(cookie: string, id: string): Promise<VueDemandeClient> {
    const reponse = await http().get(`/api/demandes/${id}`).set('Cookie', cookie);
    return (reponse.body as ReponseDemande).demande;
  }

  // --------------------------------------------------------------------------------------

  beforeAll(async () => {
    pool = creerPoolTest();
    appTest = await demarrerAppTest();
  });

  beforeEach(async () => {
    await viderBase(pool);
    await executerTransaction(pool, creerComptesDemo);
  });

  afterAll(async () => {
    await appTest.arreter();
    await pool.end();
  });

  describe('Comptes', () => {
    it('montre le plafond appliqué par la banque et l’absence de demande en cours', async () => {
      const cookie = await appTest.connecter(AMAL);

      const reponse = await http().get('/api/comptes').set('Cookie', cookie);

      expect(reponse.status).toBe(200);
      expect(reponse.body).toEqual({
        comptes: [
          {
            id: expect.any(String) as string,
            numero: 'DEMO-0001',
            plafondInitial: 10_000,
            plafondCourant: 10_000,
            plafondTemporaireActif: false,
            demandeEnCours: null,
          },
        ],
      });
    });
  });

  describe('Brouillon', () => {
    it('crée le brouillon, puis renvoie le même au lieu d’en créer un second (H1, H20)', async () => {
      const cookie = await appTest.connecter(AMAL);

      const premier = await brouillon(cookie);
      const second = await brouillon(cookie);

      expect(premier.status).toBe(201);
      expect(second.status).toBe(200);
      const demande = (premier.body as ReponseDemande).demande;
      expect((second.body as ReponseDemande).demande.id).toBe(demande.id);
      expect(demande).toMatchObject({ statut: 'BROUILLON', version: 1, reference: null });
      // Un brouillon vide : un avertissement par champ manquant (H23).
      expect((premier.body as ReponseDemande).avertissements!.map((a) => a.code)).toEqual([
        'R1',
        'R2',
        'R3',
      ]);
    });

    it('enregistre un brouillon de 60 000 DH sans justificatif, avec l’avertissement R4 (scénario 2)', async () => {
      const cookie = await appTest.connecter(YOUSSEF);

      const { demande, avertissements } = await brouillonRempli(cookie, 60_000);

      expect(demande).toMatchObject({ statut: 'BROUILLON', plafondDemande: 60_000, version: 2 });
      expect(avertissements).toEqual([
        expect.objectContaining({ code: 'R4', champ: 'justificatif' }),
      ]);
    });

    it('signale dès le brouillon un dossier client incomplet (R5)', async () => {
      const cookie = await appTest.connecter(SARA);

      const { avertissements } = await brouillonRempli(cookie, 20_000);

      expect(avertissements!.map((a) => a.code)).toEqual(['R5']);
    });

    it('refuse une modification fondée sur une version périmée (R11)', async () => {
      const cookie = await appTest.connecter(AMAL);
      const { demande } = (await brouillon(cookie)).body as ReponseDemande;
      await modifier(cookie, demande, { plafondDemande: 20_000 });

      const reponse = await modifier(cookie, demande, { plafondDemande: 30_000 });

      expect(reponse.status).toBe(409);
      expect(codesDe(reponse)).toEqual(['R11']);
    });

    it('refuse un champ que le client ne doit jamais écrire, comme statut (400)', async () => {
      const cookie = await appTest.connecter(AMAL);
      const { demande } = (await brouillon(cookie)).body as ReponseDemande;

      const reponse = await modifier(cookie, demande, { statut: 'APPROUVEE' });

      expect(reponse.status).toBe(400);
      expect(erreursDe(reponse)).toContainEqual(expect.objectContaining({ champ: 'statut' }));
    });

    it('après un abandon, le brouillon n’est pas supprimé et un nouveau est possible (H10)', async () => {
      const cookie = await appTest.connecter(AMAL);
      const { demande } = (await brouillon(cookie)).body as ReponseDemande;

      const abandon = await http()
        .post(`/api/demandes/${demande.id}/abandonner`)
        .set('Cookie', cookie)
        .send({ version: demande.version });
      const nouveau = await brouillon(cookie);

      expect((abandon.body as ReponseDemande).demande.statut).toBe('ABANDONNEE');
      expect(nouveau.status).toBe(201);
      expect((nouveau.body as ReponseDemande).demande.id).not.toBe(demande.id);
    });
  });

  describe('Soumission confirmée', () => {
    it('scénario 1 : 25 000 DH pour 3 jours, soumise avec une référence, une révision et un conseiller', async () => {
      const cookie = await appTest.connecter(AMAL);
      const { demande } = await brouillonRempli(cookie, 25_000, 3);

      const reponse = await soumettre(cookie, demande);

      expect(reponse.status).toBe(200);
      const soumise = (reponse.body as ReponseDemande).demande;
      expect(soumise).toMatchObject({
        statut: 'SOUMISE',
        reference: 'DEM-2026-000001',
        revisionCourante: 1,
        version: demande.version + 1,
        submittedAt: expect.any(String) as string,
      });

      // H9 : conseiller et équipe du client, fixés à la soumission ; révision v1 enregistrée.
      const { rows } = await pool.query<{ conseiller: string; equipe: string; revisions: number }>(
        `SELECT u.email AS conseiller, t.name AS equipe,
                (SELECT count(*)::int FROM request_revisions WHERE request_id = r.id) AS revisions
           FROM requests r JOIN users u ON u.id = r.advisor_id JOIN teams t ON t.id = r.team_id
          WHERE r.id = $1`,
        [soumise.id],
      );
      expect(rows[0]).toEqual({ conseiller: KARIM, equipe: 'Équipe A', revisions: 1 });

      const detail = await http().get(`/api/demandes/${soumise.id}`).set('Cookie', cookie);
      expect((detail.body as { revisions: unknown[] }).revisions).toEqual([
        expect.objectContaining({ revisionNo: 1, plafondDemande: 25_000, dureeJours: 3 }),
      ]);

      const evenements = await pool.query<{ action: string }>(
        'SELECT action FROM events WHERE request_id = $1 ORDER BY id',
        [soumise.id],
      );
      expect(evenements.rows.map((e) => e.action)).toEqual([
        'BROUILLON_CREE',
        'MODIFICATION',
        'SOUMISSION',
      ]);
    });

    it.each([
      ['la version', { version: 1 }],
      ['le montant', { plafondDemande: 26_000 }],
      ['la durée', { dureeJours: 4 }],
    ])(
      'refuse une confirmation dont %s ne correspond plus (R7), sans rien modifier',
      async (_cas, ecart) => {
        const cookie = await appTest.connecter(AMAL);
        const { demande } = await brouillonRempli(cookie, 25_000, 3);

        const reponse = await soumettre(cookie, demande, ecart);

        expect(reponse.status).toBe(409);
        expect(codesDe(reponse)).toEqual(['R7']);
        expect(await lireDemande(cookie, demande.id)).toMatchObject({
          statut: 'BROUILLON',
          version: demande.version,
        });
      },
    );

    it('un double clic ne soumet qu’une fois (R7)', async () => {
      const cookie = await appTest.connecter(AMAL);
      const { demande } = await brouillonRempli(cookie, 25_000);

      const [a, b] = await Promise.all([soumettre(cookie, demande), soumettre(cookie, demande)]);

      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
      const revisions = await pool.query('SELECT 1 FROM request_revisions');
      expect(revisions.rowCount).toBe(1);
    });

    it('refuse un dossier client incomplet (422 R5)', async () => {
      const cookie = await appTest.connecter(SARA);
      const { demande } = await brouillonRempli(cookie, 20_000);

      const reponse = await soumettre(cookie, demande);

      expect(reponse.status).toBe(422);
      expect(codesDe(reponse)).toEqual(['R5']);
    });

    it('R5 est revérifié dans la transaction : un dossier devenu incomplet après la première lecture est refusé', async () => {
      const cookie = await appTest.connecter(SARA);
      const { demande } = await brouillonRempli(cookie, 20_000);
      // La première lecture, avant la transaction, voit un dossier complet ; en base, celui de
      // Sara est incomplet : c'est le cas d'un statut qui change entre les deux lectures.
      const lectureReelle = accesClient.contexteDuCompte;
      const lecture = jest.spyOn(accesClient, 'contexteDuCompte');
      lecture.mockImplementationOnce(async (base, compteId) => ({
        ...(await lectureReelle(base, compteId)),
        dossierComplet: true,
      }));

      try {
        const reponse = await soumettre(cookie, demande);

        // La première lecture a bien vu un dossier complet : c'est la transaction qui refuse.
        expect(lecture).toHaveBeenCalledTimes(1);
        expect(reponse.status).toBe(422);
        expect(codesDe(reponse)).toEqual(['R5']);
        expect(
          (await pool.query("SELECT 1 FROM events WHERE action = 'SOUMISSION'")).rowCount,
        ).toBe(0);
      } finally {
        lecture.mockRestore();
      }
    });

    it('refuse 60 000 DH sans justificatif (422 R4, scénario 2)', async () => {
      const cookie = await appTest.connecter(YOUSSEF);
      const { demande } = await brouillonRempli(cookie, 60_000);

      const reponse = await soumettre(cookie, demande);

      expect(reponse.status).toBe(422);
      expect(codesDe(reponse)).toEqual(['R4']);
    });

    it('renvoie toutes les erreurs de contenu à la fois', async () => {
      const cookie = await appTest.connecter(AMAL);
      const { demande } = (await brouillon(cookie)).body as ReponseDemande;
      const rempli = (await modifier(cookie, demande, { plafondDemande: 9_000, dureeJours: 8 }))
        .body as ReponseDemande;

      const reponse = await soumettre(cookie, rempli.demande);

      expect(reponse.status).toBe(422);
      expect(codesDe(reponse)).toEqual(['R1', 'R2', 'R3']);
    });

    it('accepte un brouillon à côté d’une demande soumise (H1), mais refuse de le soumettre (R6)', async () => {
      const cookie = await appTest.connecter(AMAL);
      const premiere = await brouillonRempli(cookie, 25_000);
      await soumettre(cookie, premiere.demande);

      const seconde = await brouillonRempli(cookie, 20_000);
      const reponse = await soumettre(cookie, seconde.demande);

      expect(seconde.demande.statut).toBe('BROUILLON');
      expect(reponse.status).toBe(409);
      expect(codesDe(reponse)).toEqual(['R6']);
      const comptes = await http().get('/api/comptes').set('Cookie', cookie);
      expect(
        (comptes.body as { comptes: { demandeEnCours: unknown }[] }).comptes[0].demandeEnCours,
      ).toEqual({
        id: premiere.demande.id,
        reference: 'DEM-2026-000001',
        statut: 'SOUMISE',
      });
    });

    it('refuse toute modification d’une demande soumise : aucune réécriture silencieuse (H7)', async () => {
      const cookie = await appTest.connecter(AMAL);
      const { demande } = await brouillonRempli(cookie, 25_000);
      const soumise = ((await soumettre(cookie, demande)).body as ReponseDemande).demande;

      const reponse = await modifier(cookie, soumise, { plafondDemande: 90_000 });

      expect(reponse.status).toBe(409);
      expect(codesDe(reponse)).toEqual(['TRANSITION']);
    });
  });

  describe('Annulation (scénario 6)', () => {
    it('le client annule avant décision ; une action fondée sur l’écran ancien est refusée', async () => {
      const cookie = await appTest.connecter(AMAL);
      const { demande } = await brouillonRempli(cookie, 25_000);
      const soumise = ((await soumettre(cookie, demande)).body as ReponseDemande).demande;

      const annulation = await http()
        .post(`/api/demandes/${soumise.id}/annuler`)
        .set('Cookie', cookie)
        .send({ version: soumise.version });
      // Même écran, même version : une seconde annulation est refusée.
      const ancienEcran = await http()
        .post(`/api/demandes/${soumise.id}/annuler`)
        .set('Cookie', cookie)
        .send({ version: soumise.version });

      expect(annulation.status).toBe(200);
      expect((annulation.body as ReponseDemande).demande.statut).toBe('ANNULEE');
      expect(ancienEcran.status).toBe(409);
      expect(codesDe(ancienEcran)).toEqual(['R11']);
    });

    it('refuse d’annuler un brouillon : il s’abandonne (TRANSITION)', async () => {
      const cookie = await appTest.connecter(AMAL);
      const { demande } = (await brouillon(cookie)).body as ReponseDemande;

      const reponse = await http()
        .post(`/api/demandes/${demande.id}/annuler`)
        .set('Cookie', cookie)
        .send({ version: demande.version });

      expect(reponse.status).toBe(409);
      expect(codesDe(reponse)).toEqual(['TRANSITION']);
    });
  });

  describe('Périmètre (R14) et rôles', () => {
    it('un client ne voit pas le dossier d’un autre : 404, et le refus est tracé (scénario 3)', async () => {
      const amal = await appTest.connecter(AMAL);
      const { demande } = await brouillonRempli(amal, 25_000);
      const youssef = await appTest.connecter(YOUSSEF);

      const lecture = await http().get(`/api/demandes/${demande.id}`).set('Cookie', youssef);
      const soumission = await soumettre(youssef, demande);

      expect(lecture.status).toBe(404);
      expect(codesDe(lecture)).toEqual(['R14']);
      // 404 et non 409 : rien ne révèle que le dossier existe (règle 4).
      expect(soumission.status).toBe(404);
      const refus = await pool.query<{
        details: { action: string; cible: string; codes: string[] };
      }>(
        `SELECT e.details FROM events e JOIN users u ON u.id = e.actor_id
          WHERE e.action = 'REFUS' AND u.email = $1 ORDER BY e.id`,
        [YOUSSEF],
      );
      expect(refus.rows.map((r) => r.details)).toEqual([
        { action: 'consulter', cible: demande.id, codes: ['R14'] },
        { action: 'soumettre', cible: demande.id, codes: ['R14'] },
      ]);
      // Le dossier d'Amal n'est rattaché à aucun événement de Youssef.
      const rattaches = await pool.query(
        `SELECT 1 FROM events e JOIN users u ON u.id = e.actor_id
          WHERE e.request_id = $1 AND u.email = $2`,
        [demande.id, YOUSSEF],
      );
      expect(rattaches.rowCount).toBe(0);
    });

    it('un client ne crée pas de brouillon sur le compte d’un autre (404)', async () => {
      const amal = await appTest.connecter(AMAL);
      const compteAmal = await compteDe(amal);
      const youssef = await appTest.connecter(YOUSSEF);

      const reponse = await http()
        .post(`/api/comptes/${compteAmal}/brouillon`)
        .set('Cookie', youssef);

      expect(reponse.status).toBe(404);
      expect(codesDe(reponse)).toEqual(['R14']);
    });

    it('un conseiller n’a pas accès aux routes du client (403 ROLE)', async () => {
      const karim = await appTest.connecter(KARIM);

      const reponse = await http().get('/api/demandes').set('Cookie', karim);

      expect(reponse.status).toBe(403);
      expect(codesDe(reponse)).toEqual(['ROLE']);
    });

    it('un identifiant mal formé est refusé (400), sans atteindre la base', async () => {
      const cookie = await appTest.connecter(AMAL);

      const reponse = await http().get('/api/demandes/pas-un-uuid').set('Cookie', cookie);

      expect(reponse.status).toBe(400);
    });
  });
});
