import { promisify } from 'node:util';
import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import type { Request, RequestHandler } from 'express';
import type { Pool } from 'pg';

const TRENTE_MINUTES = 30 * 60 * 1000;
export const NOM_COOKIE_SESSION = 'portail_session';

// Les opérations de session d'express-session, en promesses.
export const regenererSession = (req: Request): Promise<void> =>
  promisify(req.session.regenerate.bind(req.session))();
export const enregistrerSession = (req: Request): Promise<void> =>
  promisify(req.session.save.bind(req.session))();
export const detruireSession = (req: Request): Promise<void> =>
  promisify(req.session.destroy.bind(req.session))();

// Le middleware de session.
// - Sessions stockées dans la table `session`, créée par la migration 001 :
//   createTableIfMissing reste désactivé, l'application ne crée jamais de table.
// - Cookie httpOnly (illisible en JavaScript) et SameSite=Strict (jamais envoyé depuis un
//   autre site : c'est la protection contre le CSRF).
// - Secure seulement si COOKIE_SECURE=true, c'est-à-dire derrière HTTPS : avec Secure,
//   express-session n'enverrait pas le cookie en HTTP (docker compose sur http://localhost).
// - Expiration après 30 minutes d'INACTIVITÉ : maxAge + rolling, qui repousse l'échéance
//   à chaque requête (maxAge seul expirerait 30 minutes après la connexion).
export function creerMiddlewareSession(pool: Pool): RequestHandler {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET doit être défini (voir .env.example).');
  }

  const StockagePostgres = connectPgSimple(session);
  return session({
    name: NOM_COOKIE_SESSION,
    secret,
    store: new StockagePostgres({ pool, tableName: 'session', createTableIfMissing: false }),
    // Pas de session tant que personne n'est connecté, ni de réécriture inutile.
    saveUninitialized: false,
    resave: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: TRENTE_MINUTES,
    },
  });
}
