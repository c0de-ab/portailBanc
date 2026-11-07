import {
  Body,
  type CanActivate,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Roles, RolesGuard } from '../auth/guards';
import { BanqueService, type ModeBanque, MODES_BANQUE } from '../banque/banque.service';

// Les routes /api/demo/... n'existent que si DEMO_MODE=true.
// Lue à chaque requête : hors démonstration, la route répond exactement comme une route
// inexistante (404), avant même le contrôle de connexion.
@Injectable()
export class ModeDemoGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.DEMO_MODE !== 'true') {
      throw new NotFoundException();
    }
    return true;
  }
}

class ModeBanqueDto {
  @IsIn(MODES_BANQUE, { message: `Le mode doit être l’un de : ${MODES_BANQUE.join(', ')}.` })
  mode!: ModeBanque;
}

// Le mode de la banque simulée, pour démontrer l'échec et la réponse perdue (scénario 5).
// Réservé au personnel de la banque.
@Controller('demo/banque')
@UseGuards(ModeDemoGuard, RolesGuard)
@Roles('CONSEILLER', 'SUPERVISEUR')
export class DemoController {
  constructor(private readonly banque: BanqueService) {}

  @Get('mode')
  lire() {
    return { mode: this.banque.lireMode() };
  }

  @Post('mode')
  @HttpCode(HttpStatus.OK)
  changer(@Body() { mode }: ModeBanqueDto) {
    this.banque.changerMode(mode);
    return { mode: this.banque.lireMode() };
  }
}
