import { Module } from '@nestjs/common';
import { BanqueModule } from '../banque/banque.module';
import { DemoController, ModeDemoGuard } from './demo.controller';

@Module({
  imports: [BanqueModule],
  controllers: [DemoController],
  providers: [ModeDemoGuard],
})
export class DemoModule {}
