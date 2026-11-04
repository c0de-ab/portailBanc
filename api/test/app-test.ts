import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurerApp } from '../src/configurer-app';
import { MOT_DE_PASSE_DEMO } from '../src/demo/comptes-demo';
import type { ErreurDetaillee } from '../src/http/erreur-api';

// L'application complète pour un test d'API, configurée comme en production (configurerApp),
// avec un faux frontend construit. `modules` ajoute des modules propres au test.
export async function demarrerAppTest(modules: Type[] = []) {
  const dossierWeb = mkdtempSync(join(tmpdir(), 'portail-web-'));
  writeFileSync(join(dossierWeb, 'index.html'), '<!doctype html><title>Portail</title>');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...modules] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configurerApp(app, dossierWeb);
  await app.init();

  return {
    app,
    http: () => request(app.getHttpServer()),
    // Connecte un compte de démonstration et renvoie son cookie de session.
    async connecter(email: string): Promise<string> {
      const reponse = await request(app.getHttpServer())
        .post('/api/auth/connexion')
        .send({ email, motDePasse: MOT_DE_PASSE_DEMO });
      if (reponse.status !== 200) {
        throw new Error(`Connexion impossible pour ${email} : ${reponse.status}`);
      }
      return cookieDe(reponse);
    },
    async arreter(): Promise<void> {
      await app.close();
      rmSync(dossierWeb, { recursive: true, force: true });
    },
  };
}

// Le cookie de session d'une réponse, prêt à être renvoyé : « portail_session=… ».
export function cookieDe(reponse: request.Response): string {
  const enTete = reponse.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = enTete?.find((c) => c.startsWith('portail_session='));
  if (!cookie) {
    throw new Error('Aucun cookie de session dans la réponse');
  }
  return cookie.split(';')[0];
}

// Les erreurs d'une réponse en erreur (règle 8).
export function erreursDe(reponse: request.Response): ErreurDetaillee[] {
  return (reponse.body as { erreurs: ErreurDetaillee[] }).erreurs;
}

// Les codes d'erreur d'une réponse, dans l'ordre.
export function codesDe(reponse: request.Response): string[] {
  return erreursDe(reponse).map((e) => e.code);
}
