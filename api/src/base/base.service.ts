import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { creerPool } from './pool';
import { executerTransaction } from './transaction';

// Accès à PostgreSQL en SQL brut.
// Les requêtes sont toujours paramétrées : `valeurs` remplit $1, $2…
// Ne jamais construire `texte` en y concaténant une valeur.
@Injectable()
export class BaseService implements OnModuleDestroy {
  private readonly pool = creerPool();

  requete<L extends QueryResultRow>(
    texte: string,
    valeurs: unknown[] = [],
  ): Promise<QueryResult<L>> {
    return this.pool.query<L>(texte, valeurs);
  }

  transaction<T>(travail: (tx: PoolClient) => Promise<T>): Promise<T> {
    return executerTransaction(this.pool, travail);
  }

  // Le pool lui-même, uniquement pour le stockage des sessions (connect-pg-simple),
  // qui gère ses propres requêtes. Le code de l'application passe par requete et transaction.
  poolPourSessions(): Pool {
    return this.pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
