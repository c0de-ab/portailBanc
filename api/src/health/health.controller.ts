import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EtatSante, HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // GET /api/health : 200 si la base répond, 503 sinon, avec le même corps dans les deux cas.
  // Ce n'est pas une erreur de l'API mais un état : le corps n'est donc pas au format { erreurs }.
  @Get()
  async lire(@Res({ passthrough: true }) res: Response): Promise<EtatSante> {
    const etat = await this.health.verifier();
    if (etat.base !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return etat;
  }
}
