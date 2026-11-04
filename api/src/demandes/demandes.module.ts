import { Module } from '@nestjs/common';
import { BanqueModule } from '../banque/banque.module';
import { HistoriqueService } from '../historique/historique.service';
import { ActivationService } from './activation.service';
import { DemandesClientController } from './demandes-client.controller';
import { DemandesClientService } from './demandes-client.service';
import { DossiersController } from './dossiers.controller';
import { DossiersService } from './dossiers.service';

@Module({
  imports: [BanqueModule],
  controllers: [DemandesClientController, DossiersController],
  providers: [DemandesClientService, DossiersService, ActivationService, HistoriqueService],
  exports: [DemandesClientService, DossiersService, ActivationService],
})
export class DemandesModule {}
