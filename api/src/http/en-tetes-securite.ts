import type { NextFunction, Request, Response } from 'express';

// En-têtes de sécurité, sans dépendance (CLAUDE.md, section Sécurité), sur toutes les réponses :
// API, fichiers du frontend et page index.html.
export function enTetesSecurite(_req: Request, res: Response, next: NextFunction): void {
  // Le navigateur respecte le type annoncé : pas de « devinette » qui exécuterait un fichier.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Interdit l'affichage du site dans un cadre (protection contre le clickjacking).
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  // L'adresse de la page n'est transmise qu'au site lui-même.
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
}
