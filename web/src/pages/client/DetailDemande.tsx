import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ErreurApi } from '../../api';
import {
  dateLisible,
  enDirhams,
  libelleClient,
  LIBELLE_DECISION,
  type Compte,
  type DetailDemande as Detail,
  type ErreurDetaillee,
} from '../../types';
import { ListeErreurs } from './FormulaireDemande';

const ANNULABLE = ['SOUMISE', 'COMPLEMENT_DEMANDE', 'ATTENTE_SUPERVISEUR'];

// L'état d'une demande, vu par le client. La décision favorable et le plafond réellement appliqué
// par la banque sont affichés séparément : l'un n'entraîne pas l'autre.
export function DetailDemande() {
  const { id } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [compte, setCompte] = useState<Compte | null>(null);
  const [erreurs, setErreurs] = useState<ErreurDetaillee[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // La lecture renvoie les données ; leur affichage est fait ensuite, hors de l'effet.
  const afficher = useCallback(([d, { comptes }]: [Detail, { comptes: Compte[] }]) => {
    setDetail(d);
    setCompte(comptes.find((c) => c.id === d.demande.compteId) ?? null);
  }, []);
  const lire = useCallback(() => Promise.all([api.demande(id!), api.comptes()]), [id]);
  const charger = async () => afficher(await lire());

  useEffect(() => {
    lire()
      .then(afficher)
      .catch((e: unknown) =>
        setErreurs(
          e instanceof ErreurApi
            ? e.erreurs
            : [{ code: 'INCONNUE', message: 'Impossible de charger la demande.' }],
        ),
      );
  }, [lire, afficher]);

  async function annuler() {
    if (!detail || !window.confirm('Annuler cette demande ? Cette action est définitive.')) {
      return;
    }
    setEnvoi(true);
    setErreurs([]);
    try {
      await api.annuler(detail.demande);
      setInfo('Demande annulée.');
    } catch (e) {
      if (e instanceof ErreurApi && e.estUnConflit) {
        setInfo('La demande a changé entre-temps : elle a été rechargée. Vérifiez son état.');
      } else {
        setErreurs(
          e instanceof ErreurApi
            ? e.erreurs
            : [{ code: 'INCONNUE', message: 'Le serveur est injoignable.' }],
        );
      }
    } finally {
      await charger().catch(() => undefined);
      setEnvoi(false);
    }
  }

  if (!detail) {
    return erreurs.length > 0 ? (
      <ListeErreurs erreurs={erreurs} />
    ) : (
      <p className="discret">Chargement…</p>
    );
  }

  const { demande, revisions, decisions } = detail;
  const libelle = libelleClient(demande);
  const dernierComplement = [...decisions].reverse().find((d) => d.type === 'DEMANDE_COMPLEMENT');

  return (
    <>
      <p>
        <Link to="/client">Mes plafonds</Link>
      </p>
      <h1>{demande.reference ? `Demande ${demande.reference}` : 'Brouillon'}</h1>
      {info && (
        <p className="message message-info" role="status">
          {info}
        </p>
      )}

      <section className={`etat etat-${libelle.ton}`}>
        <p className="etat-libelle">{libelle.texte}</p>
        {demande.statut === 'COMPLEMENT_DEMANDE' && dernierComplement && (
          <>
            <p>
              Votre conseiller demande :{' '}
              <span className="texte-libre">{dernierComplement.motif}</span>
            </p>
            <Link className="bouton" to={`/client/demandes/${demande.id}/completer`}>
              Compléter la demande
            </Link>
          </>
        )}
        {demande.statut === 'BROUILLON' && (
          <Link className="bouton" to={`/client/comptes/${demande.compteId}/brouillon`}>
            Reprendre le brouillon
          </Link>
        )}
      </section>

      <dl className="recapitulatif">
        <dt>Plafond demandé</dt>
        <dd className="chiffres">
          {demande.plafondDemande === null ? 'Non renseigné' : enDirhams(demande.plafondDemande)}
        </dd>
        <dt>Durée</dt>
        <dd>
          {demande.dureeJours === null
            ? 'Non renseignée'
            : `${demande.dureeJours} jour${demande.dureeJours > 1 ? 's' : ''}`}
        </dd>
        {compte && (
          <>
            <dt>Plafond appliqué aujourd’hui par la banque</dt>
            <dd className="chiffres">
              {enDirhams(compte.plafondCourant)}
              {!compte.plafondTemporaireActif && ' (plafond habituel)'}
            </dd>
          </>
        )}
        {demande.submittedAt && (
          <>
            <dt>Soumise le</dt>
            <dd>{dateLisible(demande.submittedAt)}</dd>
          </>
        )}
        {demande.dateActivation && (
          <>
            <dt>Actif depuis le</dt>
            <dd>{dateLisible(demande.dateActivation)}</dd>
          </>
        )}
        {demande.dateEcheance && (
          <>
            <dt>Échéance</dt>
            <dd>{dateLisible(demande.dateEcheance)}</dd>
          </>
        )}
        {demande.justificatifPresent && (
          <>
            <dt>Justificatif</dt>
            <dd>
              <a href={api.lienJustificatif(demande.id)}>
                {demande.justificatifNom ?? 'Télécharger'}
              </a>
            </dd>
          </>
        )}
      </dl>

      {decisions.length > 0 && (
        <section>
          <h2>Décisions</h2>
          <ol className="chronologie">
            {decisions.map((d, i) => (
              <li key={i}>
                <p>
                  <strong>{LIBELLE_DECISION[d.type] ?? d.type}</strong> sur la version v
                  {d.revisionNo}, le {dateLisible(d.decideeLe)}
                </p>
                <p className="texte-libre">{d.motif}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {revisions.length > 0 && (
        <section>
          <h2>Versions soumises</h2>
          <ol className="chronologie">
            {revisions.map((r) => (
              <li key={r.revisionNo}>
                <p>
                  <strong>v{r.revisionNo}</strong>, soumise le {dateLisible(r.soumiseLe)} :{' '}
                  <span className="chiffres">{enDirhams(r.plafondDemande)}</span> pendant{' '}
                  {r.dureeJours} jour
                  {r.dureeJours > 1 ? 's' : ''}
                  {r.justificatifNom && `, justificatif ${r.justificatifNom}`}
                </p>
                <p className="texte-libre">{r.motif}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <ListeErreurs erreurs={erreurs} />
      {ANNULABLE.includes(demande.statut) && (
        <div className="actions">
          <button
            type="button"
            className="lien lien-danger"
            disabled={envoi}
            onClick={() => void annuler()}
          >
            Annuler la demande
          </button>
        </div>
      )}
    </>
  );
}
