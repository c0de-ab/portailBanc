import * as argon2 from 'argon2';
import type { PoolClient } from 'pg';
import type { Role } from '../auth/utilisateur-session';

// Les comptes de démonstration. Identités, équipes, dossiers
// clients et comptes bancaires seulement : les demandes d'Inès et de Mehdi seront créées
// par les services métier, à leur étape, pour suivre le vrai parcours.
// Toutes les identités sont fictives. Le mot de passe, commun à tous les comptes, est
// documenté dans le README : ce n'est pas un secret, et il n'existe que si DEMO_MODE=true.
export const MOT_DE_PASSE_DEMO = 'Demo-2026!';

type EquipeDemo = 'Équipe A' | 'Équipe B';

type PersonnelDemo = {
  email: string;
  nom: string;
  roles: Role[];
  equipe: EquipeDemo;
};

type ClientDemo = {
  email: string;
  nom: string;
  // L'e-mail du conseiller : il définit le portefeuille.
  conseiller: string;
  dossierComplet: boolean;
  numeroCompte: string;
};

export const PERSONNEL_DEMO: PersonnelDemo[] = [
  {
    email: 'conseiller.karim@portail.test',
    nom: 'Karim',
    roles: ['CONSEILLER'],
    equipe: 'Équipe A',
  },
  {
    email: 'conseiller.nadia@portail.test',
    nom: 'Nadia',
    roles: ['CONSEILLER'],
    equipe: 'Équipe A',
  },
  {
    email: 'conseiller.salma@portail.test',
    nom: 'Salma',
    roles: ['CONSEILLER'],
    equipe: 'Équipe B',
  },
  {
    email: 'superviseur.omar@portail.test',
    nom: 'Omar',
    roles: ['SUPERVISEUR'],
    equipe: 'Équipe A',
  },
  {
    email: 'superviseur.rachid@portail.test',
    nom: 'Rachid',
    roles: ['SUPERVISEUR'],
    equipe: 'Équipe B',
  },
  // R9 : conseillère et superviseure à la fois.
  {
    email: 'mixte.leila@portail.test',
    nom: 'Leila',
    roles: ['CONSEILLER', 'SUPERVISEUR'],
    equipe: 'Équipe A',
  },
];

export const CLIENTS_DEMO: ClientDemo[] = [
  {
    email: 'client.amal@portail.test',
    nom: 'Amal',
    conseiller: 'conseiller.karim@portail.test',
    dossierComplet: true,
    numeroCompte: 'DEMO-0001',
  },
  {
    email: 'client.youssef@portail.test',
    nom: 'Youssef',
    conseiller: 'conseiller.nadia@portail.test',
    dossierComplet: true,
    numeroCompte: 'DEMO-0002',
  },
  // R5 : dossier incomplet.
  {
    email: 'client.sara@portail.test',
    nom: 'Sara',
    conseiller: 'conseiller.karim@portail.test',
    dossierComplet: false,
    numeroCompte: 'DEMO-0003',
  },
  {
    email: 'client.hamid@portail.test',
    nom: 'Hamid',
    conseiller: 'mixte.leila@portail.test',
    dossierComplet: true,
    numeroCompte: 'DEMO-0004',
  },
  {
    email: 'client.ines@portail.test',
    nom: 'Inès',
    conseiller: 'conseiller.salma@portail.test',
    dossierComplet: true,
    numeroCompte: 'DEMO-0005',
  },
  {
    email: 'client.mehdi@portail.test',
    nom: 'Mehdi',
    conseiller: 'conseiller.karim@portail.test',
    dossierComplet: true,
    numeroCompte: 'DEMO-0006',
  },
];

// Plafond initial de tous les comptes (H11), côté application et côté banque simulée.
const PLAFOND_INITIAL = 10_000;

export type BilanDemo = { equipes: number; utilisateurs: number; clients: number; comptes: number };

// Crée les comptes de démonstration qui n'existent pas encore. Idempotent : un second
// lancement ne crée rien et ne modifie rien. À exécuter dans une transaction (`tx`).
export async function creerComptesDemo(tx: PoolClient): Promise<BilanDemo> {
  const bilan: BilanDemo = { equipes: 0, utilisateurs: 0, clients: 0, comptes: 0 };
  // Un seul hachage pour le mot de passe commun.
  const hachage = await argon2.hash(MOT_DE_PASSE_DEMO, { type: argon2.argon2id });

  const idsEquipes = new Map<EquipeDemo, string>();
  for (const nom of ['Équipe A', 'Équipe B'] as const) {
    const existante = await tx.query<{ id: string }>('SELECT id FROM teams WHERE name = $1', [nom]);
    if (existante.rows[0]) {
      idsEquipes.set(nom, existante.rows[0].id);
      continue;
    }
    const creee = await tx.query<{ id: string }>(
      'INSERT INTO teams (name) VALUES ($1) RETURNING id',
      [nom],
    );
    idsEquipes.set(nom, creee.rows[0].id);
    bilan.equipes++;
  }

  // Crée l'utilisateur s'il n'existe pas, et renvoie son identifiant dans tous les cas.
  async function utilisateur(email: string, nom: string, roles: Role[], teamId: string | null) {
    const insertion = await tx.query(
      `INSERT INTO users (email, password_hash, display_name, roles, team_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING`,
      [email, hachage, nom, roles, teamId],
    );
    bilan.utilisateurs += insertion.rowCount ?? 0;
    const ligne = await tx.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    return ligne.rows[0].id;
  }

  const idsPersonnel = new Map<string, string>();
  for (const p of PERSONNEL_DEMO) {
    idsPersonnel.set(
      p.email,
      await utilisateur(p.email, p.nom, p.roles, idsEquipes.get(p.equipe)!),
    );
  }

  for (const c of CLIENTS_DEMO) {
    const userId = await utilisateur(c.email, c.nom, ['CLIENT'], null);
    const insertionClient = await tx.query(
      `INSERT INTO clients (user_id, advisor_id, dossier_complet)
       VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
      [userId, idsPersonnel.get(c.conseiller), c.dossierComplet],
    );
    bilan.clients += insertionClient.rowCount ?? 0;
    const client = await tx.query<{ id: string }>('SELECT id FROM clients WHERE user_id = $1', [
      userId,
    ]);

    const insertionCompte = await tx.query(
      `INSERT INTO accounts (client_id, numero, plafond_initial)
       VALUES ($1, $2, $3) ON CONFLICT (numero) DO NOTHING`,
      [client.rows[0].id, c.numeroCompte, PLAFOND_INITIAL],
    );
    bilan.comptes += insertionCompte.rowCount ?? 0;
    // Le plafond réellement appliqué « côté banque » (bank_limits), au départ le plafond initial.
    await tx.query(
      `INSERT INTO bank_limits (numero, plafond_courant) VALUES ($1, $2) ON CONFLICT (numero) DO NOTHING`,
      [c.numeroCompte, PLAFOND_INITIAL],
    );
  }

  return bilan;
}
