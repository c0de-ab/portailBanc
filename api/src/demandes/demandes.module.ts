import { Module } from '@nestjs/common';
import { BanqueModule } from '../banque/banque.module';
import { HistoriqueService } from '../historique/historique.service';
import { ActivationService } from './activation.service';
import { DemandesClientController } from './demandes-client.controller';
import { DemandesClientService } from './demandes-client.service';
import { DossiersController } from './dossiers.controller';
import { DossiersService } from './dossiers.service';
import { ExpirationService } from './expiration.service';
import { JustificatifsClientService } from './justificatifs-client.service';
import { SoumissionService } from './soumission.service';

@Module({
  imports: [BanqueModule],
  controllers: [DemandesClientController, DossiersController],
  providers: [
    DemandesClientService,
    SoumissionService,
    JustificatifsClientService,
    DossiersService,
    ActivationService,
    ExpirationService,
    HistoriqueService,
  ],
  // HistoriqueService est exporté : l'agent écrit dans le MÊME historique, une seule instance.
  exports: [
    DemandesClientService,
    DossiersService,
    ActivationService,
    ExpirationService,
    HistoriqueService,
  ],
})
export class DemandesModule {}
