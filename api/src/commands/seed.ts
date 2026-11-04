import { existsSync } from 'node:fs';
import { creerPool } from '../base/pool';
import { executerTransaction } from '../base/transaction';
import { creerComptesDemo } from '../demo/comptes-demo';

// npm run seed : crée les comptes de démonstration, SEULEMENT si DEMO_MODE=true.
// Idempotent : le conteneur le lance à chaque démarrage, après les migrations.
// Exécuté sur le code compilé (dist/commands/seed.js).
async function seed(): Promise<void> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  if (process.env.DEMO_MODE !== 'true') {
    console.log("Seed : DEMO_MODE n'est pas activé, aucun compte de démonstration créé.");
    return;
  }

  const pool = creerPool();
  try {
    const bilan = await executerTransaction(pool, creerComptesDemo);
    console.log(
      `Seed : ${bilan.equipes} équipe(s), ${bilan.utilisateurs} utilisateur(s), ` +
        `${bilan.clients} client(s) et ${bilan.comptes} compte(s) créés.`,
    );
  } finally {
    await pool.end();
  }
}

seed().catch((erreur: unknown) => {
  console.error('Échec du seed :', erreur);
  process.exitCode = 1;
});
