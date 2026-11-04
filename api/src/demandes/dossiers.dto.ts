import { IsIn, IsString, MaxLength } from 'class-validator';
import { VersionDto } from './demandes-client.dto';

// Corps d'une décision : la version lue (R11) et le motif. Le motif vide est accepté ici et
// refusé par le domaine (422 R10) : c'est une règle métier, pas une entrée mal formée.
export class DecisionDto extends VersionDto {
  @IsString({ message: 'Le motif de la décision doit être un texte.' })
  @MaxLength(2000, { message: 'Le motif ne peut pas dépasser 2 000 caractères.' })
  motif!: string;
}

// Une recommandation porte aussi l'avis du conseiller, transmis au superviseur.
export class RecommandationDto extends DecisionDto {
  @IsIn(['FAVORABLE', 'DEFAVORABLE'], { message: 'L’avis doit être FAVORABLE ou DEFAVORABLE.' })
  avis!: 'FAVORABLE' | 'DEFAVORABLE';
}
