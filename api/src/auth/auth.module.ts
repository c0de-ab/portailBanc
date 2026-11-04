import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConnecteGuard, RolesGuard } from './guards';

@Module({
  controllers: [AuthController],
  providers: [AuthService, ConnecteGuard, RolesGuard],
  exports: [ConnecteGuard, RolesGuard],
})
export class AuthModule {}
