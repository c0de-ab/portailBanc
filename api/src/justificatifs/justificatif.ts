import { join, resolve } from 'node:path';
import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ErreurApi } from '../http/erreur-api';

// Le justificatif fictif (CLAUDE.md, section Sécurité) : 2 Mo maximum, PDF, JPEG ou PNG.
// Seule sa présence est contrôlée (R4) ; il n'est jamais transmis au modèle IA.

export const TAILLE_MAXIMUM = 2 * 1024 * 1024;

// Le fichier reçu par Multer, réduit à ce que le code utilise (évite @types/multer).
export type FichierRecu = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

export type TypeJustificatif = 'pdf' | 'png' | 'jpg';

export const TYPE_MIME: Record<TypeJustificatif, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
};

// Les premiers octets de chaque type accepté.
const SIGNATURES: [TypeJustificatif, number[]][] = [
  ['pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]], // « %PDF- »
  ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['jpg', [0xff, 0xd8, 0xff]],
];

// Le type RÉEL du fichier, lu sur ses premiers octets, ou null s'il n'est pas accepté.
// Le type annoncé par le navigateur ne suffit jamais : il est choisi par le client.
export function detecterType(contenu: Buffer): TypeJustificatif | null {
  for (const [type, signature] of SIGNATURES) {
    if (signature.every((octet, i) => contenu[i] === octet)) {
      return type;
    }
  }
  return null;
}

// Le nom d'origine, réduit à un texte d'affichage : la dernière partie seulement (un nom comme
// « ../../config.env » ne garde que « config.env »), sans caractère de contrôle, 255 caractères
// au plus. Il ne sert JAMAIS à construire un chemin.
export function nomAffichable(nomOrigine: string): string {
  const dernierePartie = nomOrigine.split(/[\\/]/).pop() ?? '';
  // Les caractères de contrôle (codes 0 à 31, et 127) sont retirés.
  const sansControle = [...dernierePartie]
    .filter((caractere) => {
      const code = caractere.codePointAt(0)!;
      return code > 31 && code !== 127;
    })
    .join('');
  const propre = sansControle.trim().slice(0, 255);
  return propre || 'justificatif';
}

// Le dossier des justificatifs : hors du dossier public, hors de Git, volume dans Docker.
export function dossierJustificatifs(): string {
  return resolve(process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads'));
}

// Le nom stocké est toujours généré par le serveur : uuid + extension du type détecté.
const FORMAT_NOM_STOCKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg)$/;

// Le chemin complet d'un fichier stocké. Le nom est contrôlé avant d'être joint au dossier :
// même une valeur inattendue en base ne peut pas désigner un fichier hors du dossier.
export function cheminDe(nomStocke: string): string {
  if (!FORMAT_NOM_STOCKE.test(nomStocke)) {
    throw new Error(`Nom de justificatif stocké invalide : ${nomStocke}`);
  }
  return join(dossierJustificatifs(), nomStocke);
}

export function typeDe(nomStocke: string): TypeJustificatif {
  return nomStocke.slice(nomStocke.lastIndexOf('.') + 1) as TypeJustificatif;
}

export type JustificatifATelecharger = { chemin: string; typeMime: string; nomAffiche: string };

// Ce qu'il faut pour envoyer le justificatif d'une demande déjà chargée AVEC son filtre de
// périmètre. Sans justificatif : 404 INTROUVABLE.
export function justificatifATelecharger(
  nomStocke: string | null,
  nomAffiche: string | null,
): JustificatifATelecharger {
  if (!nomStocke) {
    throw new ErreurApi(HttpStatus.NOT_FOUND, [
      { code: 'INTROUVABLE', message: 'Aucun justificatif pour cette demande.' },
    ]);
  }
  return {
    chemin: cheminDe(nomStocke),
    typeMime: TYPE_MIME[typeDe(nomStocke)],
    nomAffiche: nomAffiche ?? 'justificatif',
  };
}

// Envoie le fichier : toujours en pièce jointe, jamais affiché dans la page, jamais en cache.
export function envoyerJustificatif(res: Response, justificatif: JustificatifATelecharger): void {
  // attachment() encode le nom d'origine dans Content-Disposition. Le type est fixé APRÈS :
  // il vient du type détecté à l'envoi, jamais de l'extension choisie par le client.
  res.attachment(justificatif.nomAffiche);
  res.setHeader('Content-Type', justificatif.typeMime);
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(justificatif.chemin);
}
