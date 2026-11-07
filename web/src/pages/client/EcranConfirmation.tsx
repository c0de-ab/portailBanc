import type { ReactNode } from 'react';
import { Etat, GrandMontant, Jauge, ListeErreurs } from '../../composants';
import {
  enDirhams,
  enJours,
  libelleClient,
  SEUIL_DECISION_CONSEILLER,
  SEUIL_JUSTIFICATIF,
  type Demande,
  type ErreurDetaillee,
} from '../../types';

// Qui décidera, d'après le montant (R8) : une explication pour le client ; le serveur applique
// la règle.
export function quiDecide(montant: number | null): string {
  return montant === null
    ? 'Selon le montant'
    : montant <= SEUIL_DECISION_CONSEILLER
      ? `Votre conseiller, jusqu’à ${enDirhams(SEUIL_DECISION_CONSEILLER)}`
      : `Un superviseur, au-delà de ${enDirhams(SEUIL_DECISION_CONSEILLER)}`;
}

// L'écran « Vérifiez votre demande » (R7) : le récapitulatif exact de ce qui sera soumis, et ce
// qui se passera ensuite. La soumission n'a lieu qu'au clic sur « Confirmer et soumettre ».
export function EcranConfirmation({
  demande,
  plafondInitial,
  filAriane,
  erreurs,
  envoi,
  confirmer,
  modifier,
}: {
  demande: Demande;
  plafondInitial: number | null;
  filAriane: ReactNode;
  erreurs: ErreurDetaillee[];
  envoi: boolean;
  confirmer: () => void;
  modifier: () => void;
}) {
  const montantConfirme = demande.plafondDemande!;
  const libelle = libelleClient(demande);
  return (
    <>
      <div className="entete">
        <div className="colonne ecart-8">
          {filAriane}
          <h1 className="h1">Vérifiez votre demande</h1>
          <p className="muted">
            Votre demande sera transmise telle qu’elle apparaît ici. Vous pourrez encore l’annuler
            tant qu’aucune décision n’est prise.
          </p>
        </div>
      </div>

      <div className="g12">
        <div className="colonne span-7">
          <section className="coffre interieur-40" aria-labelledby="c-titre">
            <div className="colonne ecart-12">
              <p id="c-titre" className="coffre-label">
                Plafond demandé
              </p>
              <GrandMontant montant={montantConfirme} />
              <p className="marge-haut-8">
                <Etat ton={libelle.ton}>{libelle.texte}</Etat>
              </p>
            </div>
            {plafondInitial !== null && (
              <div className="marge-haut-24">
                <Jauge
                  plafondInitial={plafondInitial}
                  applique={plafondInitial}
                  demande={montantConfirme}
                />
              </div>
            )}
          </section>

          <section className="panel panel-lignes" aria-label="Détail de la demande">
            <dl className="lignes">
              <div className="ligne">
                <dt className="ligne-cle">Plafond demandé</dt>
                <dd className="ligne-val">{enDirhams(montantConfirme)}</dd>
              </div>
              <div className="ligne">
                <dt className="ligne-cle">Durée</dt>
                <dd className="ligne-val">{enJours(demande.dureeJours!)}</dd>
              </div>
              <div className="ligne">
                <dt className="ligne-cle">Motif</dt>
                <dd className="ligne-val texte-libre">{demande.motif}</dd>
              </div>
              <div className="ligne">
                <dt className="ligne-cle">Justificatif</dt>
                <dd className="ligne-val">
                  {/* On n'arrive ici que sans avertissement : sans fichier, R4 ne s'applique pas. */}
                  {demande.justificatifNom ??
                    `Aucun, facultatif jusqu’à ${enDirhams(SEUIL_JUSTIFICATIF)}`}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="panel colonne span-5 interieur-32" aria-labelledby="ensuite-titre">
          <div className="colonne ecart-4">
            <p className="surtitre">Après votre clic</p>
            <h2 id="ensuite-titre" className="h2">
              Ce qui se passera
            </h2>
          </div>
          <ol className="frise-v" aria-label="Étapes à venir">
            <li className="etape">
              <span className="etape-point">1</span>
              <span className="etape-nom">Examen</span>
              <span className="etape-info">Par votre conseiller</span>
            </li>
            <li className="etape">
              <span className="etape-point">2</span>
              <span className="etape-nom">Décision</span>
              <span className="etape-info">{quiDecide(montantConfirme)}</span>
            </li>
            <li className="etape">
              <span className="etape-point">3</span>
              <span className="etape-nom">Activation</span>
              <span className="etape-info">
                La banque applique le plafond après une décision favorable
              </span>
            </li>
            <li className="etape">
              <span className="etape-point">4</span>
              <span className="etape-nom">Échéance</span>
              <span className="etape-info">{enJours(demande.dureeJours!)} après l’activation</span>
            </li>
          </ol>
          <ListeErreurs erreurs={erreurs} />
          <div className="separateur" />
          <div className="colonne ecart-12">
            <button
              type="button"
              className="btn btn-primaire btn-plein"
              disabled={envoi}
              onClick={confirmer}
            >
              {envoi ? 'Envoi…' : 'Confirmer et soumettre'}
            </button>
            <button type="button" className="btn btn-secondaire btn-plein" onClick={modifier}>
              Modifier la demande
            </button>
          </div>
          <p className="muted centre poids-500">Rien n’est soumis sans ce clic.</p>
        </aside>
      </div>
    </>
  );
}
