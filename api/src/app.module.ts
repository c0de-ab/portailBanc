import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
import { BaseModule } from './base/base.module';
import { DemandesModule } from './demandes/demandes.module';
import { DemoModule } from './demo/demo.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [BaseModule, HealthModule, AuthModule, DemandesModule, DemoModule, AgentModule],
})
export class AppModule {}
