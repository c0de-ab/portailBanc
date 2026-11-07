import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { BaseService } from '../base/base.service';
import type { Role, UtilisateurSession } from './utilisateur-session';

// Une ligne de la table users, avec le dossier client éventuel.
type LigneUtilisateur = {
  id: string;
  display_name: string;
  password_hash: string;
  roles: Role[];
  team_id: string | null;
  client_id: string | null;
};

@Injectable()
export class AuthService implements OnModuleInit {
  // Haché au démarrage. Sert à vérifier le mot de passe même quand l'e-mail est inconnu :
  // la réponse prend alors le même temps qu'avec un mauvais mot de passe, et ne révèle pas
  // quels e-mails existent.
  private hachageFactice = '';

  constructor(private readonly base: BaseService) {}

  async onModuleInit(): Promise<void> {
    this.hachageFactice = await argon2.hash('mot-de-passe-factice-jamais-utilise', {
      type: argon2.argon2id,
    });
  }

  // Renvoie l'utilisateur si les identifiants sont bons, sinon null — sans dire pourquoi.
  // La connexion, réussie ou refusée, est tracée dans events, jamais avec le mot de passe.
  async verifierIdentifiants(
    email: string,
    motDePasse: string,
    maintenant: Date,
  ): Promise<UtilisateurSession | null> {
    const emailNormalise = email.trim().toLowerCase();
    const { rows } = await this.base.requete<LigneUtilisateur>(
      // roles::text[] : pg ne sait pas lire un tableau d'enum (role[]) et le renverrait sous
      // forme de texte « {CLIENT} » ; un text[] arrive bien comme un tableau JavaScript.
      `SELECT u.id, u.display_name, u.password_hash, u.roles::text[] AS roles, u.team_id,
              c.id AS client_id
         FROM users u
         LEFT JOIN clients c ON c.user_id = u.id
        WHERE u.email = $1`,
      [emailNormalise],
    );
    const ligne = rows[0];

    // Toujours une vérification Argon2, que l'e-mail existe ou non.
    const valide = await argon2.verify(ligne?.password_hash ?? this.hachageFactice, motDePasse);

    // Chaque refus est tracé (règle 11). Limite connue : sans limitation de débit, volontairement
    // écartée du prototype, une rafale de tentatives fait grossir `events` d'autant. En
    // production, une limitation par adresse IP, au niveau du proxy, bornerait ce volume.
    if (!ligne || !valide) {
      await this.tracer('CONNEXION_REFUSEE', null, { email: emailNormalise }, maintenant);
      return null;
    }

    await this.tracer('CONNEXION', ligne.id, null, maintenant);
    return {
      id: ligne.id,
      displayName: ligne.display_name,
      roles: ligne.roles,
      teamId: ligne.team_id,
      clientId: ligne.client_id,
    };
  }

  async tracerDeconnexion(utilisateurId: string, maintenant: Date): Promise<void> {
    await this.tracer('DECONNEXION', utilisateurId, null, maintenant);
  }

  private async tracer(
    action: string,
    acteurId: string | null,
    details: Record<string, string> | null,
    maintenant: Date,
  ): Promise<void> {
    await this.base.requete(
      'INSERT INTO events (action, actor_id, details, created_at) VALUES ($1, $2, $3, $4)',
      [action, acteurId, details, maintenant],
    );
  }
}
