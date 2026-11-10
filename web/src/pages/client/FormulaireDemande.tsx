import { Link, useParams } from 'react-router';
import { useAssistant } from '../../assistant';
import { Etat, ListeErreurs } from '../../composants';
import { enDirhams, enJours, libelleClient, PLAFOND_MAXIMUM } from '../../types';
import { Avertissements, ChampJustificatif } from './ChampJustificatif';
import { EcranConfirmation } from './EcranConfirmation';
import { RecapitulatifDemande } from './RecapitulatifDemande';
import { entier, useFormulaireDemande } from './useFormulaireDemande';

// Un brouillon (/client/comptes/:compteId/brouillon) ou une demande en « Complément demandé »
// (/client/demandes/:id/completer). La logique (chargement, enregistrements, conflits,
// soumission) est dans useFormulaireDemande ; cette page ne fait qu'afficher. La soumission
// passe par une étape de confirmation explicite (R7).

export function FormulaireDemande() {
  const { compteId, id } = useParams();
  const { ouvrir } = useAssistant();
  const {
    demande,
    plafondInitial,
    champs,
    setChamps,
    avertissements,
    erreurs,
    info,
    setInfo,
    enregistrement,
    confirmation,
    setConfirmation,
    enregistrerPlafond,
    enregistrerDuree,
    enregistrerMotif,
    deposer,
    soumettre,
    abandonner,
  } = useFormulaireDemande(compteId, id);

  if (!demande) {
    return erreurs.length > 0 ? (
      <ListeErreurs erreurs={erreurs} />
    ) : (
      <p className="chargement">Chargement…</p>
    );
  }

  const plafond = entier(champs.plafond) ?? null;
  // Les règles viennent du serveur : les avertissements de verifierRegles (H23), renvoyés après
  // chaque enregistrement. L'écran n'en recalcule aucune ; il les montre.
  const regleNonRespectee = (code: string) => avertissements.some((a) => a.code === code);
  // R4 : au-delà du seuil, et aucun fichier encore déposé.
  const justificatifManquant = regleNonRespectee('R4');
  const justificatifUtile = justificatifManquant || demande.justificatifPresent;
  const complement = demande.statut === 'COMPLEMENT_DEMANDE';
  const pret =
    avertissements.length === 0 && demande.plafondDemande !== null && demande.dureeJours !== null;
  const libelle = libelleClient(demande);
  // R1 : le plafond enregistré sort des bornes ; la jauge le signale en couleur, seulement si
  // le montant affiché est bien celui que le serveur a vérifié (pas une saisie en cours).
  const horsBornes = regleNonRespectee('R1') && plafond === demande.plafondDemande;
  const filAriane = (
    <nav className="fil" aria-label="Fil d’Ariane">
      <Link to="/client">Mes plafonds de virement</Link>
      <span aria-hidden="true">/</span>
      <span>{confirmation ? 'Vérifiez votre demande' : 'Demande d’augmentation temporaire'}</span>
    </nav>
  );

  if (confirmation) {
    return (
      <EcranConfirmation
        demande={demande}
        plafondInitial={plafondInitial}
        filAriane={filAriane}
        erreurs={erreurs}
        envoi={enregistrement}
        confirmer={() => void soumettre()}
        modifier={() => setConfirmation(false)}
      />
    );
  }

  return (
    <>
      <div className="entete enfants-haut">
        <div className="colonne ecart-8">
          {filAriane}
          <h1 className="h1">
            {complement
              ? `Compléter la demande ${demande.reference}`
              : 'Demande d’augmentation temporaire'}
          </h1>
          <p className="muted" role="status">
            {enregistrement
              ? 'Enregistrement…'
              : 'Chaque modification est enregistrée automatiquement, sans être soumise.'}
          </p>
        </div>
        <div className="rangee">
          <button type="button" className="lien lien-bouton" onClick={() => ouvrir()}>
            Préparer avec l’assistant
          </button>
          <Etat ton={libelle.ton}>{libelle.texte}</Etat>
        </div>
      </div>
      {info && (
        <p className="message message-info marge-bas-24" role="status">
          {info}
        </p>
      )}

      <div className="g12">
        <form
          className="panel colonne span-7 interieur-40 ecart-32"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="champ">
            <label className="etiquette" htmlFor="f-montant">
              Plafond souhaité
            </label>
            <div className="saisie-montant">
              <input
                id="f-montant"
                className="saisie"
                inputMode="numeric"
                autoComplete="off"
                aria-describedby="f-montant-aide"
                value={champs.plafond}
                onChange={(e) => setChamps((c) => ({ ...c, plafond: e.target.value }))}
                onBlur={enregistrerPlafond}
              />
              <span className="suffixe" aria-hidden="true">
                DH
              </span>
            </div>
            <p id="f-montant-aide" className="aide">
              {plafondInitial !== null && `Plafond habituel : ${enDirhams(plafondInitial)}. `}
              Maximum demandable : {enDirhams(PLAFOND_MAXIMUM)}.
            </p>
          </div>

          <fieldset className="champ">
            <legend className="etiquette marge-bas-8">Durée</legend>
            <div className="choix">
              {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                <label key={j} className="choix-opt">
                  <input
                    type="radio"
                    name="duree"
                    value={j}
                    checked={champs.duree === String(j)}
                    onChange={(e) => enregistrerDuree(e.target.value)}
                  />
                  <span>{enJours(j)}</span>
                </label>
              ))}
            </div>
            <p className="aide marge-haut-8">
              De 1 à 7 jours. Le plafond revient ensuite au plafond habituel.
            </p>
          </fieldset>

          <div className="champ">
            <label className="etiquette" htmlFor="f-motif">
              Motif
            </label>
            <textarea
              id="f-motif"
              className="saisie"
              rows={3}
              maxLength={2000}
              value={champs.motif}
              onChange={(e) => setChamps((c) => ({ ...c, motif: e.target.value }))}
              onBlur={enregistrerMotif}
            />
          </div>

          {justificatifUtile && (
            <ChampJustificatif
              demande={demande}
              manquant={justificatifManquant}
              deposer={deposer}
            />
          )}

          <ListeErreurs erreurs={erreurs} />
          <Avertissements avertissements={avertissements} />

          <div className="separateur" />

          <div className="barre-actions">
            <button
              type="button"
              className="btn btn-primaire"
              disabled={!pret || enregistrement}
              onClick={() => {
                setInfo(null);
                setConfirmation(true);
              }}
            >
              Vérifier et confirmer
            </button>
            {demande.statut === 'BROUILLON' && (
              <button
                type="button"
                className="lien lien-bouton lien-refus"
                onClick={() => void abandonner()}
              >
                Abandonner le brouillon
              </button>
            )}
          </div>
        </form>

        <RecapitulatifDemande
          demande={demande}
          plafond={plafond}
          plafondInitial={plafondInitial}
          duree={champs.duree}
          horsBornes={horsBornes}
          justificatifManquant={justificatifManquant}
        />
      </div>
    </>
  );
}
