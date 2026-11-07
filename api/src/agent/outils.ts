import { IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { DescriptionOutil } from './llm-client';

// Les QUATRE outils de l'agent, et aucun autre : aucun outil
// n'approuve, n'active, ne soumet ni ne modifie des droits.

// Les arguments, validés comme le corps d'une requête : un champ non déclaré (statut, version,
// clientId…) est REFUSÉ, jamais ignoré. Ni l'identité ni la version ne viennent du modèle.
export class ArgumentsVides {}

export class ArgumentsConsulterDossier {
  @IsOptional()
  @IsUUID('4', { message: 'demandeId doit être un identifiant de demande.' })
  demandeId?: string;
}

export class ArgumentsPreparerBrouillon {
  @IsUUID('4', { message: 'compteId doit être un identifiant de compte.' })
  compteId!: string;

  @IsOptional()
  @IsInt({ message: 'plafondDemande doit être un nombre entier de dirhams.' })
  plafondDemande?: number;

  @IsOptional()
  @IsInt({ message: 'dureeJours doit être un nombre entier de jours.' })
  dureeJours?: number;

  @IsOptional()
  @IsString({ message: 'motif doit être un texte.' })
  @MaxLength(2000, { message: 'motif ne peut pas dépasser 2 000 caractères.' })
  motif?: string;
}

export class ArgumentsProposerSoumission {
  @IsUUID('4', { message: 'demandeId doit être un identifiant de demande.' })
  demandeId!: string;
}

export const NOMS_OUTILS = [
  'consulter_comptes',
  'consulter_dossier',
  'preparer_brouillon',
  'proposer_soumission',
] as const;
export type NomOutil = (typeof NOMS_OUTILS)[number];

export const CLASSE_ARGUMENTS: Record<NomOutil, new () => object> = {
  consulter_comptes: ArgumentsVides,
  consulter_dossier: ArgumentsConsulterDossier,
  preparer_brouillon: ArgumentsPreparerBrouillon,
  proposer_soumission: ArgumentsProposerSoumission,
};

// Ce que le modèle sait des outils (le schéma sert au mode connecté).
export const DESCRIPTIONS_OUTILS: DescriptionOutil[] = [
  {
    nom: 'consulter_comptes',
    description:
      'Les comptes du client : plafond appliqué par la banque, plafond temporaire éventuel, ' +
      'demande en cours (R6) et statut du dossier client (R5).',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    nom: 'consulter_dossier',
    description:
      "L'état d'une demande du client et les motifs qui lui sont visibles. Sans demandeId : " +
      'la liste de ses demandes.',
    schema: {
      type: 'object',
      properties: { demandeId: { type: 'string', format: 'uuid' } },
      additionalProperties: false,
    },
  },
  {
    nom: 'preparer_brouillon',
    description:
      'Crée ou met à jour le brouillon du compte (ou la demande en complément), et renvoie les ' +
      'avertissements des règles. Seulement après une réponse explicite du client.',
    schema: {
      type: 'object',
      properties: {
        compteId: { type: 'string', format: 'uuid' },
        plafondDemande: { type: 'integer' },
        dureeJours: { type: 'integer' },
        motif: { type: 'string', maxLength: 2000 },
      },
      required: ['compteId'],
      additionalProperties: false,
    },
  },
  {
    nom: 'proposer_soumission',
    description:
      'Affiche au client la carte de confirmation de la demande (montant, durée, motif). Ne ' +
      'soumet rien : seul le clic du client sur la carte soumet la demande.',
    schema: {
      type: 'object',
      properties: { demandeId: { type: 'string', format: 'uuid' } },
      required: ['demandeId'],
      additionalProperties: false,
    },
  },
];

// La carte de confirmation (R7) : les valeurs LUES EN BASE, et la version transmise sans être
// affichée. Le clic du client renvoie exactement ces valeurs à POST /api/demandes/:id/soumettre.
export type CarteConfirmation = {
  demandeId: string;
  version: number;
  plafondDemande: number;
  dureeJours: number;
  motif: string;
  justificatifNom: string | null;
};

// Ce que l'interface affiche, chaque type autrement.
export type ElementReponse =
  // `outil` est un texte : un outil inconnu demandé par le modèle est aussi montré (refusé).
  | { type: 'donnee'; outil: string; contenu: unknown }
  | { type: 'explication'; texte: string }
  | { type: 'action'; texte: string; demandeId: string }
  | { type: 'confirmation'; carte: CarteConfirmation };
