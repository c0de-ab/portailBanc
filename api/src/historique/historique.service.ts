import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { BaseService } from '../base/base.service';
import { estPourLAgent } from './contexte-agent';

// Un événement de l'historique (table events) : acteur, action, date, référence, version, motif.
// Jamais de secret ni de conversation complète dans `details`.
export type Evenement = {
  action: string;
  // L'utilisateur pour qui l'action est faite ; nul pour le système.
  acteurId: string | null;
  requestId?: string | null;
  reference?: string | null;
  requestVersion?: number | null;
  motif?: string | null;
  details?: Record<string, unknown> | null;
  viaAgent?: boolean;
  // Toujours l'heure réelle (H22).
  date: Date;
};

@Injectable()
export class HistoriqueService {
  constructor(private readonly base: BaseService) {}

  // Écrit l'événement avec `tx` (dans la transaction de l'action), ou seul s'il est absent :
  // un refus est écrit APRÈS l'annulation de la transaction, sinon il serait annulé avec elle.
  async ecrire(evenement: Evenement, tx?: PoolClient): Promise<void> {
    const texte = `INSERT INTO events
        (request_id, reference, actor_id, via_agent, action, request_version, motif, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
    const valeurs = [
      evenement.requestId ?? null,
      evenement.reference ?? null,
      evenement.acteurId,
      // Sans précision, l'événement est « via l'agent » s'il est écrit pendant un appel d'outil.
      evenement.viaAgent ?? estPourLAgent(),
      evenement.action,
      evenement.requestVersion ?? null,
      evenement.motif ?? null,
      evenement.details ?? null,
      evenement.date,
    ];
    if (tx) {
      await tx.query(texte, valeurs);
    } else {
      await this.base.requete(texte, valeurs);
    }
  }
}
