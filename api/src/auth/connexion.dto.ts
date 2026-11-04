import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

// Corps de POST /api/auth/connexion. Tout autre champ est refusé (ValidationPipe global).
export class ConnexionDto {
  // Normalisé AVANT la validation : « Client.Amal@Portail.test » et les espaces autour
  // désignent le même compte, et les e-mails sont enregistrés en minuscules.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'L’e-mail n’est pas valide.' })
  @MaxLength(254, { message: 'L’e-mail est trop long.' })
  email!: string;

  @IsString({ message: 'Le mot de passe est obligatoire.' })
  @MinLength(1, { message: 'Le mot de passe est obligatoire.' })
  // Borne la taille du texte haché : un mot de passe démesuré ne doit pas occuper le serveur.
  @MaxLength(200, { message: 'Le mot de passe est trop long.' })
  motDePasse!: string;
}
