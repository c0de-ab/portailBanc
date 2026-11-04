import { existsSync } from 'node:fs';
import { BanqueService } from '../banque/banque.service';
import { BaseService } from '../base/base.service';
import { ExpirationService } from '../demandes/expiration.service';
import { HistoriqueService } from '../historique/historique.service';
import { ErreurArguments, lireDateSimulee } from './arguments-expiration';

// npm run expire -- --date <date> : expire les plafonds temporaires dont l'échéance est passée à
// la date simulée, et reprend les désactivations échouées. Exécuté sur le code compilé
// (dist/commands/expirer.js), en local comme dans le conteneur.
// La banque simulée de cette commande suit BANK_MODE : elle tourne dans un processus séparé de
// l'API, et le mode changé par la route de démonstration ne la concerne pas.
async function expirer(): Promise<void> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  // Règle 9 : l'heure réelle, lue ici une fois, et la date simulée, deux dates distinctes.
  const maintenant = new Date();
  const dateSimulee = lireDateSimulee(process.argv.slice(2), maintenant);

  const base = new BaseService();
  try {
    const expiration = new ExpirationService(
      base,
      new HistoriqueService(base),
      new BanqueService(base),
    );
    const bilan = await expiration.expirer(dateSimulee, maintenant);
    console.log(
      `Expiration au ${dateSimulee.toISOString()} : ${bilan.expirees} demande(s) expirée(s), ` +
        `${bilan.enEchec} désactivation(s) en échec (reprises au prochain passage).`,
    );
  } finally {
    await base.onModuleDestroy();
  }
}

expirer().catch((erreur: unknown) => {
  // Une erreur d'utilisation : son message suffit. Sinon : l'erreur complète.
  console.error(
    'Échec de l’expiration :',
    erreur instanceof ErreurArguments ? erreur.message : erreur,
  );
  process.exitCode = 1;
});
