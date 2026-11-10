import { useState } from 'react';
import { Link } from 'react-router';
import { api, ErreurApi } from '../../api';
import { useAssistant } from '../../assistant';
import { erreursDe, Etat, GrandMontant, ListeErreurs } from '../../composants';
import { enJours, type CarteConfirmation, type ErreurDetaillee } from '../../types';

// La carte de confirmation : même récapitulatif et même route que le formulaire. La version de
// la carte est transmise sans être affichée ; si la demande a changé depuis, le serveur refuse (R7).
// C'est le seul endroit où une conversation avec l'agent peut mener à une soumission, et seulement
// par le clic du client.
export function Carte({ carte }: { carte: CarteConfirmation }) {
  const { donneesModifiees } = useAssistant();
  const [etat, setEtat] = useState<'attente' | 'envoi' | 'soumise'>('attente');
  const [erreurs, setErreurs] = useState<ErreurDetaillee[]>([]);

  async function confirmer() {
    setEtat('envoi');
    setErreurs([]);
    try {
      await api.soumettre({
        id: carte.demandeId,
        version: carte.version,
        plafondDemande: carte.plafondDemande,
        dureeJours: carte.dureeJours,
      });
      setEtat('soumise');
      donneesModifiees();
    } catch (e) {
      setEtat('attente');
      setErreurs(
        e instanceof ErreurApi && e.estUnConflit
          ? [
              {
                code: e.erreurs[0]?.code ?? 'R7',
                message:
                  'La demande a changé depuis que cette carte a été préparée. Demandez une nouvelle carte à l’assistant, ou vérifiez la demande dans le formulaire.',
              },
            ]
          : erreursDe(e),
      );
    }
  }

  return (
    <section className="coffre msg-confirmer" aria-label="À confirmer par vous">
      <div className="colonne">
        <div className="carte-entete">
          <Etat ton="action">À confirmer par vous</Etat>
          <span className="t13 muted">Brouillon préparé avec l’assistant</span>
        </div>
        <div className="carte-montant">
          <div className="colonne ecart-4">
            <p className="t13 muted">Plafond demandé</p>
            <GrandMontant montant={carte.plafondDemande} corps={48} />
          </div>
          <dl className="coffre-encart faits faits-ligne carte-faits">
            <div>
              <dt>Durée</dt>
              <dd>{enJours(carte.dureeJours)}</dd>
            </div>
            <div>
              <dt>Motif</dt>
              <dd className="texte-libre">{carte.motif}</dd>
            </div>
            <div>
              <dt>Justificatif</dt>
              <dd>{carte.justificatifNom ?? 'Aucun'}</dd>
            </div>
          </dl>
        </div>
        <ListeErreurs erreurs={erreurs} />
        <div className="coffre-sep" />
        {etat === 'soumise' ? (
          <p role="status">
            Demande soumise.{' '}
            <Link className="lien" to={`/client/demandes/${carte.demandeId}`}>
              Suivre la demande
            </Link>
          </p>
        ) : (
          <div className="rangee">
            <button
              type="button"
              className="btn btn-clair"
              disabled={etat === 'envoi'}
              onClick={() => void confirmer()}
            >
              {etat === 'envoi' ? 'Envoi…' : 'Confirmer et soumettre'}
            </button>
            <p className="muted">Rien n’est soumis sans ce clic.</p>
          </div>
        )}
      </div>
    </section>
  );
}
