import { Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { BaseService } from '../base/base.service';

// La banque simulée (docs/modele-donnees.md, § 3). Elle n'écrit QUE dans bank_limits et
// bank_operations, dans ses propres transactions : aucune clé étrangère vers l'application,
// c'est la frontière entre les deux systèmes. L'application ne lui parle que par appliquer().

export type ModeBanque = 'SUCCES' | 'ECHEC' | 'REPONSE_PERDUE';
export const MODES_BANQUE: ModeBanque[] = ['SUCCES', 'ECHEC', 'REPONSE_PERDUE'];
export type OperationBancaire = 'ACTIVER' | 'DESACTIVER';

// Ce que la banque renvoie, et mémorise avec la clé d'idempotence.
export type ResultatBancaire = {
  operation: OperationBancaire;
  plafondApplique: number;
  // H17 : la date d'application, qui devient date_activation côté application.
  appliqueLe: Date;
};

// Un appel qui n'a pas abouti. ECHEC : rien n'a été appliqué. DELAI : on ne sait pas
// (réponse perdue) ; la reprise avec la même clé retrouvera le résultat s'il existe.
export class ErreurBanque extends Error {
  constructor(
    readonly nature: 'ECHEC' | 'DELAI',
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class BanqueService {
  // Réglage de démonstration, gardé en mémoire : il repart de BANK_MODE à chaque démarrage.
  private mode: ModeBanque = modeInitial();

  constructor(private readonly base: BaseService) {}

  lireMode(): ModeBanque {
    return this.mode;
  }

  changerMode(mode: ModeBanque): void {
    this.mode = mode;
  }

  // Applique l'opération une seule fois par clé (act-<id> ou desact-<id>).
  async appliquer(
    cle: string,
    numero: string,
    operation: OperationBancaire,
    plafond: number,
    maintenant: Date,
  ): Promise<ResultatBancaire> {
    // 1. Clé déjà connue : le résultat enregistré, QUEL QUE SOIT LE MODE (H16). Sans cela,
    //    la reprise après une réponse perdue ne pourrait jamais aboutir (scénario 5).
    const connu = await this.lire(cle);
    if (connu) {
      return connu;
    }

    // 2. Clé nouvelle : le mode s'applique.
    const mode = this.mode;
    if (mode === 'ECHEC') {
      throw new ErreurBanque('ECHEC', 'La banque a refusé l’opération (mode ECHEC).');
    }

    const resultat: ResultatBancaire = {
      operation,
      plafondApplique: plafond,
      appliqueLe: maintenant,
    };
    try {
      // L'opération et le nouveau plafond, dans une seule transaction.
      await this.base.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO bank_operations (cle, numero, operation, plafond_applique, resultat, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [cle, numero, operation, plafond, resultat, maintenant],
        );
        const miseAJour = await tx.query(
          'UPDATE bank_limits SET plafond_courant = $2 WHERE numero = $1',
          [numero, plafond],
        );
        if (miseAJour.rowCount !== 1) {
          throw new ErreurBanque('ECHEC', `Compte inconnu de la banque : ${numero}.`);
        }
      });
    } catch (erreur) {
      // 3. Deux appels simultanés avec la même clé : le second échoue sur la clé primaire et
      //    relit le résultat du premier.
      if (erreur instanceof DatabaseError && erreur.constraint === 'bank_operations_pkey') {
        return (await this.lire(cle))!;
      }
      // Un compte que la banque ne connaît pas : un refus de la banque, rien n'est enregistré.
      if (erreur instanceof DatabaseError && erreur.constraint === 'bank_operations_numero_fkey') {
        throw new ErreurBanque('ECHEC', `Compte inconnu de la banque : ${numero}.`);
      }
      throw erreur;
    }

    // REPONSE_PERDUE : l'opération EST appliquée et enregistrée, mais l'appelant ne le sait pas.
    if (mode === 'REPONSE_PERDUE') {
      throw new ErreurBanque('DELAI', 'Délai dépassé : la réponse de la banque a été perdue.');
    }
    return resultat;
  }

  private async lire(cle: string): Promise<ResultatBancaire | null> {
    const { rows } = await this.base.requete<{
      resultat: { operation: OperationBancaire; plafondApplique: number; appliqueLe: string };
    }>('SELECT resultat FROM bank_operations WHERE cle = $1', [cle]);
    if (!rows[0]) {
      return null;
    }
    const { operation, plafondApplique, appliqueLe } = rows[0].resultat;
    return { operation, plafondApplique, appliqueLe: new Date(appliqueLe) };
  }
}

function modeInitial(): ModeBanque {
  const mode = process.env.BANK_MODE ?? 'SUCCES';
  if (!MODES_BANQUE.includes(mode as ModeBanque)) {
    throw new Error(`BANK_MODE invalide : ${mode} (attendu : ${MODES_BANQUE.join(', ')}).`);
  }
  return mode as ModeBanque;
}
