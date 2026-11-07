import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { UtilisateurSession } from '../auth/utilisateur-session';
import { ErreurApi } from '../http/erreur-api';
import { HistoriqueService } from '../historique/historique.service';
import { CONSIGNES } from './consignes';
import { DELAI_MODELE_MS, LLM_CLIENT, type LlmClient, type MessageModele } from './llm-client';
import { DESCRIPTIONS_OUTILS, type ElementReponse } from './outils';
import { OutilsService } from './outils.service';

// Garde-fous de l'agent (le délai de 15 s, DELAI_MODELE_MS, est dans llm-client.ts).
const APPELS_OUTILS_PAR_MESSAGE = 3;
// Tours de parole du modèle pour un message : assez pour 3 outils puis la réponse finale.
const TOURS_MAXIMUM = APPELS_OUTILS_PAR_MESSAGE + 1;
// Mémoire : les 10 derniers échanges, gardés dans la session seulement.
const ECHANGES_EN_MEMOIRE = 10;
const RESUME_OUTIL_MAXIMUM = 500;

export type ReponseAgent = { elements: ElementReponse[]; memoire: MessageModele[] };

@Injectable()
export class AgentService {
  private readonly journal = new Logger(AgentService.name);
  // Les sessions dont un message est en cours de traitement (voir uneALaFois).
  private readonly sessionsOccupees = new Set<string>();

  constructor(
    @Inject(LLM_CLIENT) private readonly modele: LlmClient,
    private readonly outils: OutilsService,
    private readonly historique: HistoriqueService,
  ) {}

  // Un seul message à la fois par session. Deux messages simultanés liraient la même mémoire,
  // et le dernier enregistré effacerait l'échange de l'autre. Le second est donc refusé (409),
  // le temps que le premier ait répondu ET enregistré la mémoire. L'API tourne en un seul
  // processus : un ensemble en mémoire suffit.
  async uneALaFois<T>(cleSession: string, travail: () => Promise<T>): Promise<T> {
    if (this.sessionsOccupees.has(cleSession)) {
      throw new ErreurApi(HttpStatus.CONFLICT, [
        {
          code: 'AGENT_OCCUPE',
          message: 'L’assistant répond déjà à votre message précédent : attendez sa réponse.',
        },
      ]);
    }
    this.sessionsOccupees.add(cleSession);
    try {
      return await travail();
    } finally {
      this.sessionsOccupees.delete(cleSession);
    }
  }

  // Un message du client : le modèle choisit des outils, le SERVEUR les exécute et décide de
  // tout. L'identité vient de la session (règle 3), jamais du message ni du modèle.
  async repondre(
    client: UtilisateurSession,
    message: string,
    memoire: MessageModele[],
    maintenant: Date,
  ): Promise<ReponseAgent> {
    const messages: MessageModele[] = [...memoire, { role: 'client', texte: message }];
    const elements: ElementReponse[] = [];
    let appelsRestants = APPELS_OUTILS_PAR_MESSAGE;

    for (let tour = 0; tour < TOURS_MAXIMUM; tour++) {
      const reponse = await this.interroger(messages);
      messages.push({ role: 'agent', texte: reponse.texte, appels: reponse.appels });
      if (reponse.texte) {
        elements.push({ type: 'explication', texte: reponse.texte });
      }
      if (reponse.appels.length === 0) {
        break;
      }

      for (const appel of reponse.appels) {
        if (appelsRestants === 0) {
          // Au-delà de 3 appels d'outils dans un message : refusé et tracé, rien n'est exécuté.
          await this.historique.ecrire({
            action: 'REFUS',
            acteurId: client.id,
            viaAgent: true,
            details: {
              action: 'outil',
              outil: appel.nom,
              raison: 'LIMITE_APPELS',
              codes: ['LIMITE_APPELS'],
            },
            date: maintenant,
          });
          messages.push({
            role: 'outil',
            idAppel: appel.id,
            nom: appel.nom,
            resultat: {
              erreurs: [
                { code: 'LIMITE_APPELS', message: 'Limite de 3 appels d’outils atteinte.' },
              ],
            },
            erreur: true,
          });
          continue;
        }
        appelsRestants--;
        const resultat = await this.outils.executer(client, appel, maintenant);
        elements.push(...resultat.elements);
        messages.push({
          role: 'outil',
          idAppel: appel.id,
          nom: appel.nom,
          resultat: resultat.pourLeModele,
          erreur: resultat.erreur,
        });
      }
    }

    return { elements, memoire: enMemoire(messages) };
  }

  // Un appel au modèle, borné à 15 s. Modèle indisponible : 503 IA_INDISPONIBLE ; le chat le
  // dit, et les formulaires restent utilisables (cahier § 04).
  private async interroger(messages: MessageModele[]) {
    let minuteur: NodeJS.Timeout | undefined;
    const delai = new Promise<never>((_resoudre, rejeter) => {
      minuteur = setTimeout(
        () => rejeter(new Error('Délai du modèle dépassé (15 s).')),
        DELAI_MODELE_MS,
      );
    });
    try {
      return await Promise.race([
        this.modele.repondre({ consignes: CONSIGNES, messages, outils: DESCRIPTIONS_OUTILS }),
        delai,
      ]);
    } catch (erreur) {
      // Jamais la clé ni la conversation dans le journal : seulement le message d'erreur.
      this.journal.warn(
        `Modèle indisponible : ${erreur instanceof Error ? erreur.message : 'erreur inconnue'}`,
      );
      throw new ErreurApi(HttpStatus.SERVICE_UNAVAILABLE, [
        {
          code: 'IA_INDISPONIBLE',
          message:
            'L’assistant est momentanément indisponible. Vous pouvez continuer avec les formulaires.',
        },
      ]);
    } finally {
      clearTimeout(minuteur);
    }
  }
}

// Les 10 derniers échanges, avec un RÉSUMÉ des résultats d'outils (pas les données complètes) :
// la session reste petite, et rien de la conversation n'est enregistré durablement.
function enMemoire(messages: MessageModele[]): MessageModele[] {
  const debuts = messages.flatMap((m, i) => (m.role === 'client' ? [i] : []));
  const depart =
    debuts.length > ECHANGES_EN_MEMOIRE ? debuts[debuts.length - ECHANGES_EN_MEMOIRE] : 0;
  return messages
    .slice(depart)
    .map((m) => (m.role === 'outil' ? { ...m, resultat: resumerResultat(m.resultat) } : m));
}

// Le résultat d'un outil, gardé en mémoire : tel quel s'il est court, sinon son début, marqué
// comme tronqué. Couper le texte JSON au milieu donnerait un JSON invalide au modèle ; un objet
// { tronque, debut } reste lisible, et dit clairement qu'il manque la fin.
export function resumerResultat(resultat: unknown): unknown {
  const texte = JSON.stringify(resultat) ?? 'null';
  if (texte.length <= RESUME_OUTIL_MAXIMUM) {
    return resultat;
  }
  return { tronque: true, debut: texte.slice(0, RESUME_OUTIL_MAXIMUM) };
}
