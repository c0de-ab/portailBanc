import { Module } from '@nestjs/common';
import { BanqueService } from './banque.service';

// Une seule instance de la banque simulée pour toute l'application : son mode est partagé.
@Module({
  providers: [BanqueService],
  exports: [BanqueService],
})
export class BanqueModule {}
