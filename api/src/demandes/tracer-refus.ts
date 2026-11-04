import type { UtilisateurSession } from '../auth/utilisateur-session';
import { ErreurApi } from '../http/erreur-api';
import type { HistoriqueService } from '../historique/historique.service';

// Règle 11 : tout refus est tracé, à un seul endroit, pour les routes du client comme pour
// celles du personnel. L'écriture a lieu APRÈS l'annulation de la transaction, par une écriture
// séparée, sinon elle serait annulée avec elle. Tout ce qui peut refuser l'action est dans
// `travail`, y compris le chargement avec le filtre de périmètre : un accès hors périmètre est
// tracé lui aussi. L'identifiant visé va dans `details`, jamais dans request_id : un dossier
// hors périmètre n'est pas rattaché à l'historique de quelqu'un d'autre.
export async function tracerLesRefus<T>(
  historique: HistoriqueService,
  acteur: UtilisateurSession,
  action: string,
  cible: string,
  maintenant: Date,
  travail: () => Promise<T>,
): Promise<T> {
  try {
    return await travail();
  } catch (erreur) {
    if (erreur instanceof ErreurApi) {
      await historique.ecrire({
        action: 'REFUS',
        acteurId: acteur.id,
        details: { action, cible, codes: erreur.erreurs.map((e) => e.code) },
        date: maintenant,
      });
    }
    throw erreur;
  }
}
