import type { Pool } from 'pg';
import { executerTransaction } from '../src/base/transaction';
import { creerComptesDemo } from '../src/demo/comptes-demo';
import { creerPoolTest, viderBase } from './outils-base';

// Les comptes de démonstration (docs/modele-donnees.md, § 7), sur la vraie base portail_test.
describe('Comptes de démonstration', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = creerPoolTest();
  });

  beforeEach(async () => {
    await viderBase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('crée 2 équipes, 12 utilisateurs, 6 clients et leurs comptes, puis plus rien au second lancement', async () => {
    const premier = await executerTransaction(pool, creerComptesDemo);
    const second = await executerTransaction(pool, creerComptesDemo);

    expect(premier).toEqual({ equipes: 2, utilisateurs: 12, clients: 6, comptes: 6 });
    expect(second).toEqual({ equipes: 0, utilisateurs: 0, clients: 0, comptes: 0 });
  });

  it('respecte les portefeuilles, les équipes et les particularités du jeu de données', async () => {
    await executerTransaction(pool, creerComptesDemo);

    const portefeuilles = await pool.query<{ conseiller: string; clients: string[] }>(`
      SELECT conseiller.email AS conseiller, array_agg(client.email ORDER BY client.email) AS clients
        FROM clients c
        JOIN users client ON client.id = c.user_id
        JOIN users conseiller ON conseiller.id = c.advisor_id
       GROUP BY conseiller.email ORDER BY conseiller.email`);
    expect(portefeuilles.rows).toEqual([
      {
        conseiller: 'conseiller.karim@portail.test',
        clients: [
          'client.amal@portail.test',
          'client.mehdi@portail.test',
          'client.sara@portail.test',
        ],
      },
      { conseiller: 'conseiller.nadia@portail.test', clients: ['client.youssef@portail.test'] },
      { conseiller: 'conseiller.salma@portail.test', clients: ['client.ines@portail.test'] },
      { conseiller: 'mixte.leila@portail.test', clients: ['client.hamid@portail.test'] },
    ]);

    const leila = await pool.query<{ roles: string[]; equipe: string }>(`
      SELECT u.roles::text[] AS roles, t.name AS equipe FROM users u JOIN teams t ON t.id = u.team_id
       WHERE u.email = 'mixte.leila@portail.test'`);
    expect(leila.rows[0]).toEqual({ roles: ['CONSEILLER', 'SUPERVISEUR'], equipe: 'Équipe A' });

    const equipeB = await pool.query<{ email: string }>(`
      SELECT u.email FROM users u JOIN teams t ON t.id = u.team_id
       WHERE t.name = 'Équipe B' ORDER BY u.email`);
    expect(equipeB.rows.map((r) => r.email)).toEqual([
      'conseiller.salma@portail.test',
      'superviseur.rachid@portail.test',
    ]);

    const incomplets = await pool.query<{ email: string }>(`
      SELECT u.email FROM clients c JOIN users u ON u.id = c.user_id WHERE NOT c.dossier_complet`);
    expect(incomplets.rows.map((r) => r.email)).toEqual(['client.sara@portail.test']);

    // Chaque compte a son plafond côté banque, au plafond initial de 10 000 DH (H11).
    const plafonds = await pool.query<{ plafond_initial: number; plafond_courant: number }>(`
      SELECT a.plafond_initial, b.plafond_courant FROM accounts a JOIN bank_limits b USING (numero)`);
    expect(plafonds.rows).toHaveLength(6);
    expect(
      plafonds.rows.every((r) => r.plafond_initial === 10_000 && r.plafond_courant === 10_000),
    ).toBe(true);

    // Aucune demande : celles d'Inès et de Mehdi viendront des services métier.
    const demandes = await pool.query('SELECT 1 FROM requests');
    expect(demandes.rowCount).toBe(0);
  });
});
