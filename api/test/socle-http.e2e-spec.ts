import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IsInt, IsString, Min } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurerApp } from '../src/configurer-app';
import type { ErreurDetaillee } from '../src/http/erreur-api';

// Le corps d'une réponse en erreur (règle 8).
function erreursDe(reponse: request.Response): ErreurDetaillee[] {
  return (reponse.body as { erreurs: ErreurDetaillee[] }).erreurs;
}

// Une entrée et des routes déclarées UNIQUEMENT pour ce test : elles n'existent pas dans src/.
class EntreeDeTest {
  @IsInt({ message: 'Le nombre doit être un entier.' })
  @Min(1, { message: 'Le nombre doit valoir au moins 1.' })
  nombre!: number;

  @IsString({ message: 'Le nom doit être un texte.' })
  nom!: string;
}

@Controller('test-socle')
class ControleurDeTest {
  @Post()
  recevoir(@Body() entree: EntreeDeTest) {
    // Renvoie aussi le type reçu : vérifie que le corps a été transformé en instance du DTO.
    return { ...entree, estUneInstance: entree instanceof EntreeDeTest };
  }

  @Get('panne')
  tomberEnPanne(): never {
    throw new Error('détail interne à ne jamais montrer : mot-de-passe-123');
  }
}

@Module({ controllers: [ControleurDeTest] })
class ModuleDeTest {}

describe('Socle HTTP : format des erreurs, validation, en-têtes', () => {
  let app: NestExpressApplication;
  let dossierWeb: string;

  beforeAll(async () => {
    dossierWeb = mkdtempSync(join(tmpdir(), 'portail-web-'));
    writeFileSync(join(dossierWeb, 'index.html'), '<!doctype html><title>Portail</title>');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ModuleDeTest],
    }).compile();
    // logger: false : la panne volontaire n'encombre pas la sortie des tests.
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configurerApp(app, dossierWeb);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dossierWeb, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());

  describe('Format unique des erreurs (règle 8)', () => {
    it('une route inconnue renvoie 404 INTROUVABLE au format { erreurs }', async () => {
      const reponse = await http().get('/api/route-inexistante');

      expect(reponse.status).toBe(404);
      expect(reponse.body).toEqual({
        erreurs: [{ code: 'INTROUVABLE', message: expect.any(String) as string }],
      });
    });

    it('une erreur inattendue renvoie 500 sans aucun détail technique', async () => {
      const reponse = await http().get('/api/test-socle/panne');

      expect(reponse.status).toBe(500);
      expect(reponse.body).toEqual({
        erreurs: [{ code: 'ERREUR_INTERNE', message: expect.any(String) as string }],
      });
      expect(reponse.text).not.toMatch(/mot-de-passe|détail interne|Error/);
    });
  });

  describe('Validation des entrées (400 VALIDATION)', () => {
    it('accepte une entrée valide et la transforme en instance du DTO', async () => {
      const reponse = await http().post('/api/test-socle').send({ nombre: 3, nom: 'Amal' });

      expect(reponse.status).toBe(201);
      expect(reponse.body).toEqual({ nombre: 3, nom: 'Amal', estUneInstance: true });
    });

    it('refuse un champ non déclaré, comme statut ou version : il n’est jamais ignoré', async () => {
      const reponse = await http()
        .post('/api/test-socle')
        .send({ nombre: 3, nom: 'Amal', statut: 'APPROUVEE', version: 99 });

      expect(reponse.status).toBe(400);
      expect(erreursDe(reponse)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'VALIDATION', champ: 'statut' }),
          expect.objectContaining({ code: 'VALIDATION', champ: 'version' }),
        ]),
      );
    });

    it('refuse un type faux, avec le message du DTO', async () => {
      const reponse = await http().post('/api/test-socle').send({ nombre: 'trois', nom: 'Amal' });

      expect(reponse.status).toBe(400);
      expect(erreursDe(reponse)).toContainEqual({
        code: 'VALIDATION',
        champ: 'nombre',
        message: 'Le nombre doit être un entier.',
      });
    });

    it('renvoie toutes les erreurs à la fois', async () => {
      const reponse = await http().post('/api/test-socle').send({ nombre: 0 });

      expect(reponse.status).toBe(400);
      const champs = erreursDe(reponse).map((e) => e.champ);
      expect(champs).toEqual(expect.arrayContaining(['nombre', 'nom']));
    });
  });

  describe('En-têtes de sécurité', () => {
    it.each(['/api/health', '/api/route-inexistante', '/une/page/du/frontend'])(
      'sont présents sur %s',
      async (chemin) => {
        const reponse = await http().get(chemin);

        expect(reponse.headers['x-content-type-options']).toBe('nosniff');
        const politique = reponse.headers['content-security-policy'];
        expect(politique).toContain("default-src 'self'");
        expect(politique).toContain("frame-ancestors 'none'");
        expect(reponse.headers['referrer-policy']).toBe('same-origin');
        expect(reponse.headers['x-powered-by']).toBeUndefined();
      },
    );

    it('les réponses de l’API ne sont jamais mises en cache, celles du frontend si', async () => {
      expect((await http().get('/api/health')).headers['cache-control']).toBe('no-store');
      expect((await http().get('/une/page/du/frontend')).headers['cache-control']).not.toBe(
        'no-store',
      );
    });
  });
});
