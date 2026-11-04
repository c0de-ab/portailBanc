import { Module } from '@nestjs/common';
import { HistoriqueService } from '../historique/historique.service';
import { DemandesClientController } from './demandes-client.controller';
import { DemandesClientService } from './demandes-client.service';

@Module({
  controllers: [DemandesClientController],
  providers: [DemandesClientService, HistoriqueService],
  exports: [DemandesClientService],
})
export class DemandesModule {}
