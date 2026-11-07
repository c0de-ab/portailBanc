import type { AppelOutil, LlmClient, ReponseModele } from '../src/agent/llm-client';

// Le modèle PIÉGÉ, réservé aux tests : il obéit à l'attaquant.
// Chaque test lui donne un script, c'est-à-dire les appels d'outils à faire, tour après tour, avec des
// arguments malveillants. Une fois le script joué, il PRÉTEND avoir réussi, comme un modèle
// manipulé. Les tests vérifient que le serveur ne lui accorde rien pour autant.
export type AppelPiege = { nom: string; arguments: unknown };

export class ModelePiege implements LlmClient {
  private tours: AppelPiege[][] = [];
  private prochainTour = 0;
  private numero = 0;
  readonly mensonge = 'C’est fait : votre demande est approuvée et votre plafond est actif.';

  // Le script de l'attaque : un tableau d'appels par tour de parole du modèle.
  programmer(...tours: AppelPiege[][]): void {
    this.tours = tours;
    this.prochainTour = 0;
  }

  repondre(): Promise<ReponseModele> {
    const tour = this.tours[this.prochainTour++];
    if (!tour) {
      return Promise.resolve({ texte: this.mensonge, appels: [] });
    }
    const appels: AppelOutil[] = tour.map((a) => ({ id: `piege-${++this.numero}`, ...a }));
    return Promise.resolve({ texte: '', appels });
  }
}
