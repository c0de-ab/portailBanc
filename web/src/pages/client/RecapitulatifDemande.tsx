import { GrandMontant, Jauge } from '../../composants';
import { enDirhams, enJours, SEUIL_JUSTIFICATIF, type Demande } from '../../types';
import { quiDecide } from './EcranConfirmation';

// Le récapitulatif à droite du formulaire : le montant saisi, la jauge et les conditions qui en
// découlent. Il ne fait qu'afficher : les règles viennent du serveur (avertissements).
export function RecapitulatifDemande({
  demande,
  plafond,
  plafondInitial,
  duree,
  horsBornes,
  justificatifManquant,
}: {
  demande: Demande;
  plafond: number | null;
  plafondInitial: number | null;
  duree: string;
  horsBornes: boolean;
  justificatifManquant: boolean;
}) {
  return (
    <aside className="coffre span-5 interieur-32" aria-labelledby="recap-titre">
      <div className="colonne ecart-24">
        <div className="colonne ecart-8">
          <h2 id="recap-titre" className="coffre-label">
            Récapitulatif
          </h2>
          <p className="t13 muted">Plafond demandé</p>
          {plafond === null ? (
            <p className="montant-s muted">Non renseigné</p>
          ) : (
            <GrandMontant montant={plafond} corps={64} />
          )}
        </div>

        {plafondInitial !== null && (
          <Jauge
            plafondInitial={plafondInitial}
            applique={plafondInitial}
            demande={plafond}
            horsBornes={horsBornes}
          />
        )}

        <div className="coffre-encart lignes encart-lignes">
          <div className="ligne">
            <span className="ligne-cle">Plafond habituel</span>
            <span className="ligne-val">
              {plafondInitial === null ? '…' : enDirhams(plafondInitial)}
            </span>
          </div>
          <div className="ligne">
            <span className="ligne-cle">Durée</span>
            <span className="ligne-val">
              {duree === '' ? 'Non renseignée' : enJours(Number(duree))}
            </span>
          </div>
          <div className="ligne">
            <span className="ligne-cle">Décision</span>
            <span className="ligne-val">{quiDecide(plafond)}</span>
          </div>
          <div className="ligne">
            <span className="ligne-cle">Justificatif</span>
            <span className="ligne-val">
              {demande.justificatifNom ??
                (justificatifManquant
                  ? 'Obligatoire, à déposer'
                  : `Facultatif jusqu’à ${enDirhams(SEUIL_JUSTIFICATIF)}`)}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
