import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BaseModule } from './base/base.module';
import { DemandesModule } from './demandes/demandes.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [BaseModule, HealthModule, AuthModule, DemandesModule],
})
export class AppModule {}
