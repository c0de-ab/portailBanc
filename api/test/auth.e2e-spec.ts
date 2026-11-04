import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Roles, RolesGuard } from '../src/auth/guards';
import { configurerApp } from '../src/configurer-app';
import { executerTransaction } from '../src/base/transaction';
import { creerComptesDemo, MOT_DE_PASSE_DEMO } from '../src/demo/comptes-demo';
import type { ErreurDetaillee } from '../src/http/erreur-api';
import { creerPoolTest, viderBase } from './outils-base';

// Une route réservée aux superviseurs, déclarée UNIQUEMENT pour ce test (jamais dans src/).
@Controller('test-roles')
@UseGuards(RolesGuard)
class ControleurDeTest {
  @Get('superviseur')
  @Roles('SUPERVISEUR')
  reserveeAuxSuperviseurs() {
    return { acces: 'accordé' };
  }
}

@Module({ controllers: [ControleurDeTest] })
class ModuleDeTest {}

const AMAL = 'client.amal@portail.test';
const KARIM = 'conseiller.karim@portail.test';
const LEILA = 'mixte.leila@portail.test';
const OMAR = 'superviseur.omar@portail.test';

// Le cookie de session d'une réponse, prêt à être renvoyé : « portail_session=… ».
function cookieDe(reponse: request.Response): string {
  const enTete = reponse.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = enTete?.find((c) => c.startsWith('portail_session='));
  if (!cookie) {
    throw new Error('Aucun cookie de session dans la réponse');
  }
  return cookie.split(';')[0];
}

function erreursDe(reponse: request.Response): ErreurDetaillee[] {
  return (reponse.body as { erreurs: ErreurDetaillee[] }).erreurs;
}

describe('Authentification par sessions', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let dossierWeb: string;

  const http = () => request(app.getHttpServer());
  const connecter = (email: string, motDePasse = MOT_DE_PASSE_DEMO, cookie?: string) => {
    const requete = http().post('/api/auth/connexion');
    if (cookie) requete.set('Cookie', cookie);
    return requete.send({ email, motDePasse });
  };
  const moi = (cookie?: string) => {
    const requete = http().get('/api/auth/moi');
    if (cookie) requete.set('Cookie', cookie);
    return requete;
  };

  beforeAll(async () => {
    pool = creerPoolTest();
    dossierWeb = mkdtempSync(join(tmpdir(), 'portail-web-'));
    writeFileSync(join(dossierWeb, 'index.html'), '<!doctype html><title>Portail</title>');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ModuleDeTest],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configurerApp(app, dossierWeb);
    await app.init();
  });

  beforeEach(async () => {
    await viderBase(pool);
    await executerTransaction(pool, creerComptesDemo);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    rmSync(dossierWeb, { recursive: true, force: true });
  });

  describe('Connexion', () => {
    it('renvoie l’utilisateur et un cookie httpOnly, SameSite=Strict, valable 30 minutes', async () => {
      const avant = Date.now();
      const reponse = await connecter(AMAL);

      expect(reponse.status).toBe(200);
      expect(reponse.body).toEqual({
        utilisateur: {
          id: expect.any(String) as string,
          displayName: 'Amal',
          roles: ['CLIENT'],
          teamId: null,
          clientId: expect.any(String) as string,
        },
      });
      expect(reponse.text).not.toMatch(/password|argon2/i);

      const enTete = (reponse.headers['set-cookie'] as unknown as string[]).join('; ');
      expect(enTete).toMatch(/HttpOnly/);
      expect(enTete).toMatch(/SameSite=Strict/);
      // COOKIE_SECURE=false dans .env.test : pas de Secure en HTTP.
      expect(enTete).not.toMatch(/Secure/);
      const expiration = Date.parse(/Expires=([^;]+)/.exec(enTete)![1]);
      expect(expiration - avant).toBeGreaterThan(29 * 60 * 1000);
      expect(expiration - avant).toBeLessThanOrEqual(31 * 60 * 1000);
    });

    it('ignore la casse et les espaces autour de l’e-mail', async () => {
      const reponse = await connecter('  Client.Amal@Portail.TEST ');

      expect(reponse.status).toBe(200);
    });

    it('donne exactement la même réponse pour un e-mail inconnu et un mauvais mot de passe', async () => {
      const inconnu = await connecter('personne@portail.test');
      const mauvais = await connecter(AMAL, 'mauvais-mot-de-passe');

      expect(inconnu.status).toBe(401);
      expect(mauvais.status).toBe(401);
      expect(inconnu.body).toEqual(mauvais.body);
      expect(erreursDe(inconnu)).toEqual([
        { code: 'AUTH', message: 'E-mail ou mot de passe incorrect.' },
      ]);
      // Aucune session n'est créée pour une connexion refusée.
      expect(inconnu.headers['set-cookie']).toBeUndefined();
    });

    it('refuse une entrée mal formée (400 VALIDATION)', async () => {
      const reponse = await http().post('/api/auth/connexion').send({ email: 'pas-un-email' });

      expect(reponse.status).toBe(400);
      expect(erreursDe(reponse).map((e) => e.champ)).toEqual(
        expect.arrayContaining(['email', 'motDePasse']),
      );
    });
  });

  describe('Session', () => {
    it('GET /api/auth/moi sans session renvoie 401 AUTH', async () => {
      const reponse = await moi();

      expect(reponse.status).toBe(401);
      expect(erreursDe(reponse)).toEqual([{ code: 'AUTH', message: expect.any(String) as string }]);
    });

    it('GET /api/auth/moi avec la session renvoie l’utilisateur, et repousse l’expiration (rolling)', async () => {
      const cookie = cookieDe(await connecter(KARIM));

      const reponse = await moi(cookie);

      expect(reponse.status).toBe(200);
      expect(
        (reponse.body as { utilisateur: { displayName: string } }).utilisateur.displayName,
      ).toBe('Karim');
      // rolling : chaque requête renvoie le cookie avec une nouvelle échéance.
      expect(reponse.headers['set-cookie']).toBeDefined();
    });

    it('régénère la session à la connexion : l’ancien identifiant ne donne plus accès', async () => {
      const ancien = cookieDe(await connecter(AMAL));

      const nouveau = cookieDe(await connecter(KARIM, MOT_DE_PASSE_DEMO, ancien));

      expect(nouveau).not.toBe(ancien);
      expect((await moi(ancien)).status).toBe(401);
      expect((await moi(nouveau)).status).toBe(200);
    });

    it('la déconnexion détruit la session côté serveur', async () => {
      const cookie = cookieDe(await connecter(AMAL));

      const reponse = await http().post('/api/auth/deconnexion').set('Cookie', cookie);

      expect(reponse.status).toBe(204);
      expect((await moi(cookie)).status).toBe(401);
      const sessions = await pool.query('SELECT 1 FROM session');
      expect(sessions.rowCount).toBe(0);
    });
  });

  describe('Rôles (RolesGuard)', () => {
    it('refuse un utilisateur non connecté (401 AUTH)', async () => {
      expect((await http().get('/api/test-roles/superviseur')).status).toBe(401);
    });

    it.each([AMAL, KARIM])('refuse un rôle insuffisant (403 ROLE) : %s', async (email) => {
      const cookie = cookieDe(await connecter(email));
      const reponse = await http().get('/api/test-roles/superviseur').set('Cookie', cookie);

      expect(reponse.status).toBe(403);
      expect(erreursDe(reponse)).toEqual([{ code: 'ROLE', message: expect.any(String) as string }]);
    });

    it.each([OMAR, LEILA])(
      'accepte un superviseur, y compris à double rôle (%s)',
      async (email) => {
        const cookie = cookieDe(await connecter(email));
        const reponse = await http().get('/api/test-roles/superviseur').set('Cookie', cookie);

        expect(reponse.status).toBe(200);
      },
    );
  });

  describe('Historique', () => {
    it('trace la connexion, le refus et la déconnexion, jamais le mot de passe', async () => {
      const cookie = cookieDe(await connecter(AMAL));
      await connecter(AMAL, 'mauvais-mot-de-passe');
      await http().post('/api/auth/deconnexion').set('Cookie', cookie);

      const { rows } = await pool.query<{
        action: string;
        acteur: string | null;
        details: unknown;
      }>(
        `SELECT e.action, u.email AS acteur, e.details
           FROM events e LEFT JOIN users u ON u.id = e.actor_id
          ORDER BY e.id`,
      );
      expect(rows).toEqual([
        { action: 'CONNEXION', acteur: AMAL, details: null },
        { action: 'CONNEXION_REFUSEE', acteur: null, details: { email: AMAL } },
        { action: 'DECONNEXION', acteur: AMAL, details: null },
      ]);
      const texte = JSON.stringify(rows);
      expect(texte).not.toContain(MOT_DE_PASSE_DEMO);
      expect(texte).not.toContain('mauvais-mot-de-passe');
    });
  });
});
