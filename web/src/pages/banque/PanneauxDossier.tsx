import { Etat, ListeErreurs } from '../../composants';
import {
  enDirhams,
  enJours,
  SEUIL_DECISION_CONSEILLER,
  type Dossier,
  type ErreurDetaillee,
} from '../../types';
import { ModeBanqueDemo } from './ModeBanqueDemo';

// Les deux panneaux d'action du détail d'un dossier. Ils n'affichent que ce que l'API permet :
// les actions viennent du serveur, qui reste seul juge au clic (R8, R9, R11…).

export type Action = 'demander-complement' | 'approuver' | 'rejeter' | 'favorable' | 'defavorable';

export const LIBELLE_ACTION: Record<Action, string> = {
  'demander-complement': 'Demander un complément',
  approuver: 'Approuver',
  rejeter: 'Rejeter',
  favorable: 'Recommander : avis favorable',
  defavorable: 'Recommander : avis défavorable',
};

// La décision : un motif obligatoire (R10), puis l'une des actions permises.
export function PanneauDecision({
  demande,
  actions,
  motif,
  changerMotif,
  erreurs,
  envoi,
  decider,
}: {
  demande: Dossier;
  actions: Action[];
  motif: string;
  changerMotif: (motif: string) => void;
  erreurs: ErreurDetaillee[];
  envoi: string | null;
  decider: (action: Action) => void;
}) {
  const montant = demande.plafondDemande ?? 0;
  return (
    <aside className="panel colonne interieur-32 ecart-24" aria-labelledby="decision-titre">
      <div className="colonne ecart-8">
        <p className="surtitre">Votre action</p>
        <h2 id="decision-titre" className="h2">
          Décision
        </h2>
        <p className="muted">
          {demande.statut === 'ATTENTE_SUPERVISEUR'
            ? `Au-delà de ${enDirhams(SEUIL_DECISION_CONSEILLER)}, le superviseur décide.`
            : montant <= SEUIL_DECISION_CONSEILLER
              ? `Jusqu’à ${enDirhams(SEUIL_DECISION_CONSEILLER)}, vous décidez.`
              : `Au-delà de ${enDirhams(SEUIL_DECISION_CONSEILLER)}, vous transmettez le dossier avec votre recommandation.`}
        </p>
      </div>
      <div className="champ">
        <label className="etiquette" htmlFor="d-motif">
          Motif, communiqué avec la décision
        </label>
        <textarea
          id="d-motif"
          className="saisie saisie-motif"
          rows={4}
          maxLength={2000}
          value={motif}
          onChange={(e) => changerMotif(e.target.value)}
        />
        <p className="aide">Le motif est obligatoire pour toute décision.</p>
      </div>
      <ListeErreurs erreurs={erreurs} />
      <div className="colonne ecart-12">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            className={`btn btn-plein ${
              action === 'rejeter' || action === 'defavorable'
                ? 'btn-refus'
                : action === 'demander-complement'
                  ? 'btn-secondaire'
                  : 'btn-primaire'
            }`}
            disabled={envoi !== null || motif.trim() === ''}
            onClick={() => decider(action)}
          >
            {LIBELLE_ACTION[action]}
          </button>
        ))}
      </div>
      {envoi && (
        <p className="t13 muted" role="status">
          {envoi}
        </p>
      )}
      <div className="separateur" />
      <p className="t13 muted">
        Une décision favorable n’active pas le plafond : il n’est actif qu’une fois appliqué par la
        banque.
      </p>
    </aside>
  );
}

// L'activation à reprendre (H12, H15) : la décision reste acquise, seule la banque est rappelée.
export function PanneauRelance({
  demande,
  etat,
  plafondApplique,
  erreurs,
  envoi,
  relancer,
}: {
  demande: Dossier;
  etat: string;
  plafondApplique: number;
  erreurs: ErreurDetaillee[];
  envoi: string | null;
  relancer: () => void;
}) {
  return (
    <aside className="panel colonne interieur-32 ecart-24" aria-labelledby="activation-titre">
      <div className="colonne ecart-12">
        <h2 id="activation-titre" className="h2">
          Activation
        </h2>
        <Etat ton="action">{etat}</Etat>
      </div>
      <dl className="lignes">
        <div className="ligne ligne-serree">
          <dt className="ligne-cle">Décision favorable</dt>
          <dd className="ligne-val">
            {enDirhams(demande.plafondDemande ?? 0)}
            {demande.dureeJours !== null && `, ${enJours(demande.dureeJours)}`}
          </dd>
        </div>
        <div className="ligne ligne-serree">
          <dt className="ligne-cle">Plafond appliqué par la banque</dt>
          <dd className="ligne-val">{enDirhams(plafondApplique)}, inchangé</dd>
        </div>
      </dl>
      {demande.derniereErreur && (
        <div className="colonne ecart-8">
          <p className="etiquette">Dernière erreur de la banque</p>
          <div className="boite-erreur" role="status">
            <p className="poids-500">{demande.derniereErreur}</p>
          </div>
        </div>
      )}
      <ModeBanqueDemo />
      <ListeErreurs erreurs={erreurs} />
      <button
        type="button"
        className="btn btn-primaire btn-plein"
        disabled={envoi !== null}
        onClick={relancer}
      >
        Relancer l’activation
      </button>
      {envoi && (
        <p className="t13 muted" role="status">
          {envoi}
        </p>
      )}
      <div className="separateur" />
      <p className="t13 muted">
        La décision reste acquise : seule l’activation par la banque est relancée, et la banque ne
        l’applique jamais deux fois.
      </p>
    </aside>
  );
}
