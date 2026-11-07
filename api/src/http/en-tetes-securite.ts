import type { NextFunction, Request, Response } from 'express';

// Politique de contenu : tout vient du site lui-même. Le frontend construit n'a ni script ni
// style en ligne ; seules les polices, intégrées au CSS par Vite, arrivent en `data:`.
// frame-ancestors interdit l'affichage du site dans un cadre (clickjacking).
const POLITIQUE_DE_CONTENU = [
  "default-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// En-têtes de sécurité, sans dépendance, sur toutes les réponses :
// API, fichiers du frontend et page index.html.
export function enTetesSecurite(req: Request, res: Response, next: NextFunction): void {
  // Le navigateur respecte le type annoncé : pas de « devinette » qui exécuterait un fichier.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', POLITIQUE_DE_CONTENU);
  // L'adresse de la page n'est transmise qu'au site lui-même.
  res.setHeader('Referrer-Policy', 'same-origin');
  // Les réponses de l'API (comptes, dossiers) ne sont jamais gardées en cache : après la
  // déconnexion, le bouton Retour d'un poste partagé ne les réaffiche pas.
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}
