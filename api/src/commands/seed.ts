import { existsSync } from 'node:fs';
import { BaseService } from '../base/base.service';
import { creerPool } from '../base/pool';
import { executerTransaction } from '../base/transaction';
import { creerComptesDemo } from '../demo/comptes-demo';
import { creerDemandesDemo } from '../demo/demandes-demo';

// npm run seed : crée le jeu de démonstration, SEULEMENT si DEMO_MODE=true.
// D'abord les identités et les comptes, puis les demandes, par les services métier.
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

  // Les services métier utilisent leur propre accès à la base, comme dans l'application.
  const base = new BaseService();
  try {
    const demandes = await creerDemandesDemo(base, new Date());
    console.log(
      demandes.length === 0
        ? 'Seed : demandes de démonstration déjà présentes.'
        : `Seed : demandes de démonstration créées : ${demandes.join(', ')}.`,
    );
  } finally {
    await base.onModuleDestroy();
  }
}

seed().catch((erreur: unknown) => {
  console.error('Échec du seed :', erreur);
  process.exitCode = 1;
});
