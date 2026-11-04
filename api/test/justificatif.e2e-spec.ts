import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import type request from 'supertest';
import { executerTransaction } from '../src/base/transaction';
import type { VueDemandeClient } from '../src/demandes/demande';
import { creerComptesDemo } from '../src/demo/comptes-demo';
import { codesDe, demarrerAppTest, erreursDe } from './app-test';
import { creerPoolTest, viderBase } from './outils-base';

// Le justificatif, par les routes, sur la vraie base et dans un dossier de stockage temporaire.

const AMAL = 'client.amal@portail.test';
const YOUSSEF = 'client.youssef@portail.test';

const PDF = Buffer.from('%PDF-1.4\n% justificatif fictif\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const TEXTE = Buffer.from('ceci est un texte, pas un PDF');

type ReponseDemande = { demande: VueDemandeClient; avertissements: { code: string }[] };

describe('Justificatif', () => {
  let pool: Pool;
  let dossier: string;
  let appTest: Awaited<ReturnType<typeof demarrerAppTest>>;
  const http = () => appTest.http();

  async function brouillon(cookie: string, plafondDemande = 60_000) {
    const comptes = await http().get('/api/comptes').set('Cookie', cookie);
    const compteId = (comptes.body as { comptes: { id: string }[] }).comptes[0].id;
    const cree = (await http().post(`/api/comptes/${compteId}/brouillon`).set('Cookie', cookie))
      .body as ReponseDemande;
    const rempli = await http()
      .patch(`/api/demandes/${cree.demande.id}`)
      .set('Cookie', cookie)
      .send({ version: cree.demande.version, plafondDemande, dureeJours: 3, motif: 'Achat' });
    return (rempli.body as ReponseDemande).demande;
  }

  function deposer(
    cookie: string,
    demande: VueDemandeClient,
    contenu: Buffer,
    nom: string,
    type: string,
    version = demande.version,
  ) {
    return http()
      .put(`/api/demandes/${demande.id}/justificatif`)
      .set('Cookie', cookie)
      .field('version', String(version))
      .attach('fichier', contenu, { filename: nom, contentType: type });
  }

  // Lit la réponse brute (le fichier), sans la transformer.
  function telecharger(cookie: string, id: string) {
    return http()
      .get(`/api/demandes/${id}/justificatif`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, fin) => {
        const morceaux: Buffer[] = [];
        res.on('data', (morceau: Buffer) => morceaux.push(morceau));
        res.on('end', () => fin(null, Buffer.concat(morceaux)));
      });
  }

  const fichiersStockes = () => readdirSync(dossier);

  beforeAll(async () => {
    dossier = mkdtempSync(join(tmpdir(), 'portail-justificatifs-'));
    process.env.UPLOADS_DIR = dossier;
    pool = creerPoolTest();
    appTest = await demarrerAppTest();
  });

  beforeEach(async () => {
    await viderBase(pool);
    await executerTransaction(pool, creerComptesDemo);
    // Chaque test part d'un dossier de stockage vide.
    for (const fichier of readdirSync(dossier)) {
      rmSync(join(dossier, fichier));
    }
  });

  afterAll(async () => {
    await appTest.arreter();
    await pool.end();
    rmSync(dossier, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  describe('Dépôt', () => {
    it('enregistre un PDF sous un nom généré, et R4 disparaît des avertissements', async () => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);
      const avant = new Set(fichiersStockes());

      const reponse = await deposer(cookie, demande, PDF, 'facture-été.pdf', 'application/pdf');

      expect(reponse.status).toBe(200);
      const { demande: modifiee, avertissements } = reponse.body as ReponseDemande;
      expect(modifiee).toMatchObject({
        justificatifPresent: true,
        justificatifNom: 'facture-été.pdf',
        version: demande.version + 1,
      });
      expect(avertissements).toEqual([]);

      const nouveaux = fichiersStockes().filter((f) => !avant.has(f));
      expect(nouveaux).toHaveLength(1);
      expect(nouveaux[0]).toMatch(/^[0-9a-f-]{36}\.pdf$/);
      expect(readFileSync(join(dossier, nouveaux[0]))).toEqual(PDF);
      // Le nom du fichier sur le disque n'est jamais montré au client.
      expect(JSON.stringify(reponse.body)).not.toContain(nouveaux[0]);
    });

    it('un nom piégé ne sert jamais de chemin : le fichier reste dans le dossier prévu', async () => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);

      const reponse = await deposer(
        cookie,
        demande,
        PDF,
        '../../config.env.pdf',
        'application/pdf',
      );

      expect(reponse.status).toBe(200);
      expect((reponse.body as ReponseDemande).demande.justificatifNom).toBe('config.env.pdf');
      expect(fichiersStockes().every((f) => /^[0-9a-f-]{36}\.pdf$/.test(f))).toBe(true);
    });

    it.each([
      ['un PNG', PNG, 'photo.png', 'image/png'],
      ['un JPEG', JPEG, 'scan.jpg', 'image/jpeg'],
    ])('accepte %s', async (_cas, contenu, nom, type) => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);

      const reponse = await deposer(cookie, demande, contenu, nom, type);

      expect(reponse.status).toBe(200);
    });

    it.each([
      ['un texte annoncé comme PDF', TEXTE, 'faux.pdf', 'application/pdf'],
      ['un PNG annoncé comme PDF', PNG, 'image.pdf', 'application/pdf'],
      ['un PDF annoncé comme texte', PDF, 'doc.txt', 'text/plain'],
    ])('refuse %s (400 VALIDATION), sans rien écrire', async (_cas, contenu, nom, type) => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);
      const avant = fichiersStockes().length;

      const reponse = await deposer(cookie, demande, contenu, nom, type);

      expect(reponse.status).toBe(400);
      expect(erreursDe(reponse)).toEqual([
        expect.objectContaining({ code: 'VALIDATION', champ: 'fichier' }),
      ]);
      expect(fichiersStockes()).toHaveLength(avant);
    });

    it('refuse un fichier de plus de 2 Mo (413 VALIDATION)', async () => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);
      const gros = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024)]);

      const reponse = await deposer(cookie, demande, gros, 'gros.pdf', 'application/pdf');

      expect(reponse.status).toBe(413);
      expect(erreursDe(reponse)).toEqual([
        expect.objectContaining({ code: 'VALIDATION', champ: 'fichier' }),
      ]);
    });

    it('refuse un envoi sans fichier (400)', async () => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);

      const reponse = await http()
        .put(`/api/demandes/${demande.id}/justificatif`)
        .set('Cookie', cookie)
        .field('version', String(demande.version));

      expect(reponse.status).toBe(400);
    });

    it('refuse un dépôt fondé sur une version périmée (R11), puis sur une demande soumise (TRANSITION)', async () => {
      const cookie = await appTest.connecter(AMAL);
      const demande = await brouillon(cookie, 25_000);

      const perimee = await deposer(
        cookie,
        demande,
        PDF,
        'a.pdf',
        'application/pdf',
        demande.version - 1,
      );
      const soumise = await http()
        .post(`/api/demandes/${demande.id}/soumettre`)
        .set('Cookie', cookie)
        .send({ version: demande.version, plafondDemande: 25_000, dureeJours: 3 });
      const apresSoumission = await deposer(
        cookie,
        (soumise.body as ReponseDemande).demande,
        PDF,
        'a.pdf',
        'application/pdf',
      );

      expect(codesDe(perimee)).toEqual(['R11']);
      expect(apresSoumission.status).toBe(409);
      expect(codesDe(apresSoumission)).toEqual(['TRANSITION']);
    });

    it('remplace le justificatif, sans jamais supprimer l’ancien fichier', async () => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);
      const premier = (
        (await deposer(cookie, demande, PDF, 'v1.pdf', 'application/pdf')).body as ReponseDemande
      ).demande;

      const second = await deposer(cookie, premier, PNG, 'v2.png', 'image/png');

      expect((second.body as ReponseDemande).demande.justificatifNom).toBe('v2.png');
      expect(fichiersStockes().filter((f) => f.endsWith('.pdf'))).toHaveLength(1);
      expect(fichiersStockes().filter((f) => f.endsWith('.png'))).toHaveLength(1);
    });
  });

  describe('Scénario 2 : 60 000 DH avec justificatif', () => {
    it('est soumise, et la révision v1 garde le justificatif', async () => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);
      const avecJustificatif = (
        (await deposer(cookie, demande, PDF, 'rib.pdf', 'application/pdf')).body as ReponseDemande
      ).demande;

      const reponse = await http()
        .post(`/api/demandes/${demande.id}/soumettre`)
        .set('Cookie', cookie)
        .send({ version: avecJustificatif.version, plafondDemande: 60_000, dureeJours: 3 });

      expect(reponse.status).toBe(200);
      const detail = await http().get(`/api/demandes/${demande.id}`).set('Cookie', cookie);
      expect((detail.body as { revisions: unknown[] }).revisions).toEqual([
        expect.objectContaining({ revisionNo: 1, justificatifNom: 'rib.pdf' }),
      ]);
    });
  });

  describe('Téléchargement', () => {
    it('renvoie le fichier en pièce jointe, avec le type détecté et sans cache', async () => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);
      await deposer(cookie, demande, PDF, 'facture-été.pdf', 'application/pdf');

      const reponse: request.Response = await telecharger(cookie, demande.id);

      expect(reponse.status).toBe(200);
      expect(reponse.headers['content-type']).toMatch(/^application\/pdf/);
      // « é » existe en latin-1 : Express l'écrit directement dans filename.
      expect(reponse.headers['content-disposition']).toBe('attachment; filename="facture-été.pdf"');
      expect(reponse.headers['x-content-type-options']).toBe('nosniff');
      expect(reponse.headers['cache-control']).toBe('no-store');
      expect(reponse.body).toEqual(PDF);
    });

    it('encode un nom hors latin-1 dans filename*, avec un nom de repli en ASCII', async () => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);
      await deposer(cookie, demande, PDF, 'reçu-€.pdf', 'application/pdf');

      const reponse: request.Response = await telecharger(cookie, demande.id);

      expect(reponse.headers['content-disposition']).toContain(
        "filename*=UTF-8''re%C3%A7u-%E2%82%AC.pdf",
      );
    });

    it('refuse le justificatif d’un autre client (404 R14), et trace le refus', async () => {
      const youssef = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(youssef);
      await deposer(youssef, demande, PDF, 'rib.pdf', 'application/pdf');
      const amal = await appTest.connecter(AMAL);

      const reponse = await http()
        .get(`/api/demandes/${demande.id}/justificatif`)
        .set('Cookie', amal);

      expect(reponse.status).toBe(404);
      expect(codesDe(reponse)).toEqual(['R14']);
      const refus = await pool.query(
        `SELECT 1 FROM events e JOIN users u ON u.id = e.actor_id
          WHERE e.action = 'REFUS' AND u.email = $1 AND e.details->>'action' = 'telechargerJustificatif'`,
        [AMAL],
      );
      expect(refus.rowCount).toBe(1);
    });

    it('répond 404 INTROUVABLE quand la demande n’a pas de justificatif', async () => {
      const cookie = await appTest.connecter(YOUSSEF);
      const demande = await brouillon(cookie);

      const reponse = await http()
        .get(`/api/demandes/${demande.id}/justificatif`)
        .set('Cookie', cookie);

      expect(reponse.status).toBe(404);
      expect(codesDe(reponse)).toEqual(['INTROUVABLE']);
    });
  });
});
