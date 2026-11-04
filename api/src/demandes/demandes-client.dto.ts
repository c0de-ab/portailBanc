import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

// Corps des routes du client. Tout champ non déclaré ici (statut, reference, clientId…) est
// refusé par le ValidationPipe global : un client ne peut jamais les écrire.
// Les règles métier (bornes, durée, motif obligatoire) ne sont PAS ici : elles sont dans le
// domaine, qui les renvoie en avertissements sur un brouillon et en refus à la soumission.

const VERSION = { message: 'La version de la demande est obligatoire.' };

export class VersionDto {
  @IsInt(VERSION)
  @Min(1, VERSION)
  version!: number;
}

export class ModifierDemandeDto extends VersionDto {
  // Un montant décimal est refusé dès la validation des entrées (docs/modele-donnees.md).
  @IsOptional()
  @IsInt({ message: 'Le plafond demandé doit être un nombre entier de dirhams.' })
  plafondDemande?: number | null;

  @IsOptional()
  @IsInt({ message: 'La durée doit être un nombre entier de jours.' })
  dureeJours?: number | null;

  @IsOptional()
  @IsString({ message: 'Le motif doit être un texte.' })
  @MaxLength(2000, { message: 'Le motif ne peut pas dépasser 2 000 caractères.' })
  motif?: string | null;
}

// R7 : le client renvoie ce qu'il a vu et confirmé, avec la version transmise sans être affichée.
export class SoumettreDto extends VersionDto {
  @IsInt({ message: 'Le plafond confirmé est obligatoire.' })
  plafondDemande!: number;

  @IsInt({ message: 'La durée confirmée est obligatoire.' })
  dureeJours!: number;
}
