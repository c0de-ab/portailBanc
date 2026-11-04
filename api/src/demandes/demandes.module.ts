import { Module } from '@nestjs/common';
import { HistoriqueService } from '../historique/historique.service';
import { DemandesClientController } from './demandes-client.controller';
import { DemandesClientService } from './demandes-client.service';
import { DossiersController } from './dossiers.controller';
import { DossiersService } from './dossiers.service';

@Module({
  controllers: [DemandesClientController, DossiersController],
  providers: [DemandesClientService, DossiersService, HistoriqueService],
  exports: [DemandesClientService, DossiersService],
})
export class DemandesModule {}
