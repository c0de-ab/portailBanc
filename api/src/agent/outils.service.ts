import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import { BaseService } from '../base/base.service';
import { vueClient } from '../demandes/demande';
import { DemandesClientService } from '../demandes/demandes-client.service';
import { ErreurApi } from '../http/erreur-api';
import { pourLAgent } from '../historique/contexte-agent';
import { HistoriqueService } from '../historique/historique.service';
import type { AppelOutil } from './llm-client';
import {
  type ArgumentsConsulterDossier,
  type ArgumentsPreparerBrouillon,
  type ArgumentsProposerSoumission,
  CLASSE_ARGUMENTS,
  type ElementReponse,
  NOMS_OUTILS,
  type NomOutil,
} from './outils';

// Le résultat d'un appel d'outil : ce que le modèle reçoit, et ce que l'interface affiche.
export type ResultatOutil = {
  pourLeModele: unknown;
  erreur: boolean;
  elements: ElementReponse[];
};

type Erreurs = { erreurs: { code: string; champ?: string; message: string }[] };

// L'exécution des outils de l'agent. Chaque outil appelle les MÊMES services que les routes
// (règle 2), avec le client de la session (règle 3) : l'agent n'a aucun pouvoir de plus qu'un
// formulaire. Tout se fait « pour l'agent » : les événements portent via_agent = true.
@Injectable()
export class OutilsService {
  constructor(
    private readonly base: BaseService,
    private readonly historique: HistoriqueService,
    private readonly demandes: DemandesClientService,
  ) {}

  executer(
    client: UtilisateurSession,
    appel: AppelOutil,
    maintenant: Date,
  ): Promise<ResultatOutil> {
    return pourLAgent(async () => {
      // 1. Un outil inconnu (par exemple « approuver ») : refusé et tracé.
      if (!estOutil(appel.nom)) {
        return this.refuser(client, appel, maintenant, 'OUTIL_INCONNU', {
          erreurs: [{ code: 'OUTIL_INCONNU', message: `L’outil « ${appel.nom} » n’existe pas.` }],
        });
      }

      // 2. Des arguments invalides ou en trop (statut, version…) : refusés et tracés.
      const invalides = await argumentsInvalides(appel.nom, appel.arguments);
      if (invalides) {
        return this.refuser(client, appel, maintenant, 'ARGUMENTS_INVALIDES', invalides);
      }

      // 3. L'outil, par les services métier. Leurs refus (404 hors périmètre, 409…) sont déjà
      //    tracés par eux ; le modèle reçoit l'erreur et ne peut pas prétendre avoir agi.
      try {
        const resultat = await this.lancer(
          client,
          appel.nom,
          appel.arguments as object,
          maintenant,
        );
        await this.tracer(client, appel, maintenant, 'OK');
        return resultat;
      } catch (erreur) {
        if (erreur instanceof ErreurApi) {
          const contenu: Erreurs = { erreurs: erreur.erreurs };
          await this.tracer(client, appel, maintenant, 'REFUSE', erreur.erreurs[0].code);
          return {
            pourLeModele: contenu,
            erreur: true,
            elements: [{ type: 'donnee', outil: appel.nom, contenu }],
          };
        }
        throw erreur;
      }
    });
  }

  private async lancer(
    client: UtilisateurSession,
    nom: NomOutil,
    args: object,
    maintenant: Date,
  ): Promise<ResultatOutil> {
    switch (nom) {
      case 'consulter_comptes': {
        const comptes = await this.demandes.comptes(client);
        // R5 : l'agent prévient dès le début d'un dossier incomplet (H23).
        const { rows } = await this.base.requete<{ dossier_complet: boolean }>(
          'SELECT dossier_complet FROM clients WHERE id = $1',
          [client.clientId],
        );
        const contenu = { comptes, dossierComplet: rows[0].dossier_complet };
        return donnee(nom, contenu);
      }

      case 'consulter_dossier': {
        const { demandeId } = args as ArgumentsConsulterDossier;
        if (!demandeId) {
          const demandes = (await this.demandes.lister(client)).map(vueClient);
          return donnee(nom, { demandes });
        }
        const detail = await this.demandes.detail(client, demandeId, maintenant);
        return donnee(nom, { ...detail, demande: vueClient(detail.demande) });
      }

      case 'preparer_brouillon': {
        const { compteId, ...contenu } = args as ArgumentsPreparerBrouillon;
        // H20 : la demande en Complément demandé du compte, sinon son brouillon. La version est
        // toujours relue ici, côté serveur, jamais fournie par le modèle.
        const enComplement = await this.base.requete<{ id: string; version: number }>(
          `SELECT id, version FROM requests
            WHERE account_id = $1 AND client_id = $2 AND statut = 'COMPLEMENT_DEMANDE'`,
          [compteId, client.clientId],
        );
        const cible =
          enComplement.rows[0] ??
          (await this.demandes.obtenirBrouillon(client, compteId, maintenant)).demande;
        const { demande, avertissements } = await this.demandes.modifier(
          client,
          cible.id,
          cible.version,
          contenu,
          maintenant,
        );
        const pourLeModele = { demande: vueClient(demande), avertissements };
        return {
          pourLeModele,
          erreur: false,
          elements: [
            { type: 'action', texte: 'Brouillon enregistré.', demandeId: demande.id },
            { type: 'donnee', outil: nom, contenu: pourLeModele },
          ],
        };
      }

      case 'proposer_soumission': {
        const { demandeId } = args as ArgumentsProposerSoumission;
        const { demande } = await this.demandes.detail(client, demandeId, maintenant);
        if (demande.statut !== 'BROUILLON' && demande.statut !== 'COMPLEMENT_DEMANDE') {
          throw new ErreurApi(409, [
            { code: 'TRANSITION', message: 'Cette demande ne peut plus être soumise.' },
          ]);
        }
        // Pas de carte tant qu'une règle n'est pas respectée : la soumission serait refusée.
        const avertissements = await this.demandes.avertissements(demande);
        if (avertissements.length > 0) {
          throw new ErreurApi(422, avertissements);
        }
        const carte = {
          demandeId: demande.id,
          version: demande.version,
          plafondDemande: demande.plafondDemande!,
          dureeJours: demande.dureeJours!,
          motif: demande.motif!,
          justificatifNom: demande.justificatifNom,
        };
        return {
          pourLeModele: { carteAffichee: true, ...carte },
          erreur: false,
          elements: [{ type: 'confirmation', carte }],
        };
      }
    }
  }

  // Chaque appel d'outil est tracé (règle 11) : l'outil, ses arguments utiles, et le résultat.
  // Jamais le texte de la conversation.
  private tracer(
    client: UtilisateurSession,
    appel: AppelOutil,
    maintenant: Date,
    resultat: 'OK' | 'REFUSE',
    code?: string,
  ) {
    return this.historique.ecrire({
      action: 'AGENT_OUTIL',
      acteurId: client.id,
      viaAgent: true,
      details: {
        outil: appel.nom,
        arguments: appel.arguments ?? null,
        resultat,
        code: code ?? null,
      },
      date: maintenant,
    });
  }

  private async refuser(
    client: UtilisateurSession,
    appel: AppelOutil,
    maintenant: Date,
    raison: string,
    contenu: Erreurs,
  ): Promise<ResultatOutil> {
    // Une tentative de contournement : un refus sensible, tracé (règle 11).
    await this.historique.ecrire({
      action: 'REFUS',
      acteurId: client.id,
      viaAgent: true,
      details: {
        action: 'outil',
        outil: appel.nom,
        raison,
        codes: contenu.erreurs.map((e) => e.code),
      },
      date: maintenant,
    });
    return {
      pourLeModele: contenu,
      erreur: true,
      elements: [{ type: 'donnee', outil: appel.nom, contenu }],
    };
  }
}

function estOutil(nom: string): nom is NomOutil {
  return (NOMS_OUTILS as readonly string[]).includes(nom);
}

function donnee(outil: NomOutil, contenu: unknown): ResultatOutil {
  return { pourLeModele: contenu, erreur: false, elements: [{ type: 'donnee', outil, contenu }] };
}

// Valide les arguments avec le DTO de l'outil, comme le ValidationPipe valide un corps.
async function argumentsInvalides(nom: NomOutil, args: unknown): Promise<Erreurs | null> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { erreurs: [{ code: 'VALIDATION', message: 'Les arguments doivent être un objet.' }] };
  }
  const instance = plainToInstance(CLASSE_ARGUMENTS[nom], args);
  // forbidUnknownValues: false, sinon un outil sans argument (classe sans règle) serait toujours
  // refusé ; les arguments en trop restent refusés par whitelist + forbidNonWhitelisted.
  const erreurs = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: false,
  });
  if (erreurs.length === 0) {
    return null;
  }
  return {
    erreurs: erreurs.map((e) => ({
      code: 'VALIDATION',
      champ: e.property,
      message: e.constraints?.whitelistValidation
        ? `L’argument « ${e.property} » n’est pas accepté.`
        : Object.values(e.constraints ?? {})[0],
    })),
  };
}
