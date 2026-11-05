import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ErreurApi } from '../../api';
import {
  dateBreve,
  enDirhams,
  libelleClient,
  LIBELLE_DECISION,
  type Compte,
  type DetailDemande as Detail,
  type ErreurDetaillee,
} from '../../types';
import { Etat, Frise, GrandMontant, Jauge, ListeErreurs } from '../../composants';

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
      <p className="chargement">Chargement…</p>
    );
  }

  const { demande, revisions, decisions } = detail;
  const libelle = libelleClient(demande);
  const dernierComplement = [...decisions].reverse().find((d) => d.type === 'DEMANDE_COMPLEMENT');
  const duree = (jours: number) => `${jours} jour${jours > 1 ? 's' : ''}`;

  return (
    <>
      <nav className="fil" aria-label="Fil d’Ariane">
        <Link to="/client">Mes plafonds de virement</Link>
        <span aria-hidden="true">/</span>
        <span>{demande.reference ?? 'Brouillon'}</span>
      </nav>
      <div className="entete" style={{ alignItems: 'flex-start' }}>
        <div className="colonne" style={{ gap: 8 }}>
          <div className="titre-ligne">
            <h1 className="h1">{demande.reference ?? 'Brouillon'}</h1>
            <Etat ton={libelle.ton} className="etat-long">
              {libelle.texte}
            </Etat>
          </div>
          {demande.plafondDemande !== null && (
            <p className="muted">
              {enDirhams(demande.plafondDemande)}
              {demande.dureeJours !== null && ` pendant ${duree(demande.dureeJours)}`}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {demande.statut === 'BROUILLON' && (
            <Link className="btn btn-primaire" to={`/client/comptes/${demande.compteId}/brouillon`}>
              Reprendre le brouillon
            </Link>
          )}
          {ANNULABLE.includes(demande.statut) && (
            <button
              type="button"
              className="btn btn-secondaire"
              disabled={envoi}
              onClick={() => void annuler()}
            >
              Annuler la demande
            </button>
          )}
        </div>
      </div>
      {info && (
        <p className="message message-info" role="status" style={{ marginBottom: 24 }}>
          {info}
        </p>
      )}
      <ListeErreurs erreurs={erreurs} />

      <div className="g12">
        {demande.statut === 'COMPLEMENT_DEMANDE' && (
          <section
            className="bandeau-action"
            style={{ gridColumn: 'span 12', padding: 40 }}
            aria-labelledby="action-titre"
          >
            <div className="g12" style={{ alignItems: 'end' }}>
              <div className="colonne" style={{ gridColumn: 'span 8', gap: 16 }}>
                <h2 id="action-titre" className="h2 titre-action">
                  Complément demandé : action requise
                </h2>
                {dernierComplement && (
                  <div className="colonne" style={{ gap: 8 }}>
                    <p className="t13" style={{ color: '#5A6472', fontWeight: 500 }}>
                      Message de votre conseiller
                    </p>
                    <blockquote className="citation" style={{ margin: 0 }}>
                      <p className="t17 texte-libre">{dernierComplement.motif}</p>
                      <p className="t13 muted" style={{ marginTop: 8 }}>
                        {dateBreve(dernierComplement.decideeLe)}
                      </p>
                    </blockquote>
                  </div>
                )}
              </div>
              <div className="colonne" style={{ gridColumn: '10 / span 3', gap: 12 }}>
                <Link
                  className="btn btn-primaire btn-plein"
                  to={`/client/demandes/${demande.id}/completer`}
                >
                  Compléter la demande
                </Link>
                <p className="t13 muted">
                  Vous modifierez votre demande, puis la soumettrez à nouveau en version{' '}
                  {demande.revisionCourante + 1}.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Le plafond appliqué et le plafond demandé côte à côte : l'un n'entraîne pas l'autre. */}
        <section
          className="coffre"
          style={{ gridColumn: 'span 12', padding: '48px 56px 40px' }}
          aria-label="Plafond appliqué et plafond demandé"
        >
          <div className="coffre-haut">
            <div className="colonne" style={{ gap: 12 }}>
              <p className="coffre-label">Plafond appliqué aujourd’hui par la banque</p>
              {compte ? (
                <>
                  <GrandMontant montant={compte.plafondCourant} />
                  <p style={{ marginTop: 8 }}>
                    {compte.plafondTemporaireActif ? (
                      <Etat ton="actif">Plafond temporaire actif</Etat>
                    ) : (
                      <Etat ton="neutre">Plafond habituel</Etat>
                    )}
                  </p>
                </>
              ) : (
                <p className="montant-s">…</p>
              )}
            </div>
            <div
              className="coffre-encart colonne"
              style={{ padding: 24, minWidth: 360, maxWidth: 420, gap: 8 }}
            >
              <p className="coffre-label">Plafond demandé</p>
              {demande.plafondDemande === null ? (
                <p className="montant-s">Non renseigné</p>
              ) : (
                <GrandMontant montant={demande.plafondDemande} taille="s" />
              )}
              <p style={{ marginTop: 4 }}>
                <Etat ton={libelle.ton} className="etat-long">
                  {libelle.texte}
                </Etat>
              </p>
            </div>
          </div>

          {compte && (
            <div style={{ marginTop: 32 }}>
              <Jauge
                plafondInitial={compte.plafondInitial}
                applique={compte.plafondCourant}
                demande={demande.plafondDemande}
                legendeLongue
              />
            </div>
          )}

          <div className="coffre-sep" style={{ margin: '32px 0' }} />
          <dl className="faits faits-4">
            <div>
              <dt>Durée</dt>
              <dd>{demande.dureeJours === null ? 'Non renseignée' : duree(demande.dureeJours)}</dd>
            </div>
            {demande.submittedAt && (
              <div>
                <dt>Soumise le</dt>
                <dd>{dateBreve(demande.submittedAt)}</dd>
              </div>
            )}
            {demande.dateActivation && (
              <div>
                <dt>Actif depuis</dt>
                <dd>{dateBreve(demande.dateActivation)}</dd>
              </div>
            )}
            {demande.dateEcheance && (
              <div>
                <dt>Échéance</dt>
                <dd>{dateBreve(demande.dateEcheance)}</dd>
              </div>
            )}
            {demande.justificatifPresent && (
              <div>
                <dt>Justificatif</dt>
                <dd>
                  <a className="lien" href={api.lienJustificatif(demande.id)}>
                    {demande.justificatifNom ?? 'Télécharger'}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </section>

        {['ANNULEE', 'ABANDONNEE'].includes(demande.statut) ? null : (
          <section
            className="panel"
            style={{ gridColumn: 'span 12', padding: '32px 40px' }}
            aria-label="Étapes de la demande"
          >
            <Frise demande={demande} />
          </section>
        )}

        {decisions.length > 0 && (
          <section
            className="panel colonne"
            style={{
              gridColumn: revisions.length > 0 ? 'span 7' : 'span 12',
              padding: 32,
              marginTop: 16,
            }}
            aria-labelledby="decisions-titre"
          >
            <h2 id="decisions-titre" className="h2">
              Décisions
            </h2>
            <ul className="lignes">
              {[...decisions].reverse().map((d, i) => (
                <li
                  key={i}
                  className="colonne"
                  style={{
                    gap: 8,
                    padding: '24px 0',
                    borderTop: i === 0 ? undefined : '1px solid #E9E6DF',
                    paddingTop: i === 0 ? 0 : 24,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 16,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Etat ton={d.type === 'REJET' ? 'refus' : 'neutre'}>
                      {LIBELLE_DECISION[d.type] ?? d.type}
                    </Etat>
                    <span className="t13 muted">
                      Sur la v{d.revisionNo}, le {dateBreve(d.decideeLe)}
                    </span>
                  </div>
                  <p
                    className="t15 texte-libre"
                    style={{ padding: '12px 16px', borderRadius: 12, background: '#F7F5F1' }}
                  >
                    {d.motif}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {revisions.length > 0 && (
          <section
            className="panel colonne"
            style={{
              gridColumn: decisions.length > 0 ? 'span 5' : 'span 12',
              padding: 32,
              marginTop: 16,
            }}
            aria-labelledby="versions-titre"
          >
            <h2 id="versions-titre" className="h2">
              Versions soumises
            </h2>
            <div className="colonne" style={{ gap: 0 }}>
              {[...revisions].reverse().map((r, i) => (
                <div
                  key={r.revisionNo}
                  className="colonne"
                  style={{
                    gap: 12,
                    paddingTop: i === 0 ? 0 : 24,
                    paddingBottom: 24,
                    borderTop: i === 0 ? undefined : '1px solid #E3DFD7',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 16,
                    }}
                  >
                    <span className="h3">v{r.revisionNo}</span>
                    <span className="t13 muted">Soumise le {dateBreve(r.soumiseLe)}</span>
                  </div>
                  <dl className="lignes t15">
                    <div className="ligne" style={{ padding: '8px 0' }}>
                      <dt className="ligne-cle">Plafond</dt>
                      <dd className="ligne-val">{enDirhams(r.plafondDemande)}</dd>
                    </div>
                    <div className="ligne" style={{ padding: '8px 0' }}>
                      <dt className="ligne-cle">Durée</dt>
                      <dd className="ligne-val">{duree(r.dureeJours)}</dd>
                    </div>
                    <div className="ligne" style={{ padding: '8px 0' }}>
                      <dt className="ligne-cle">Motif</dt>
                      <dd className="ligne-val texte-libre">{r.motif}</dd>
                    </div>
                    <div className="ligne" style={{ padding: '8px 0' }}>
                      <dt className="ligne-cle">Justificatif</dt>
                      <dd className="ligne-val">{r.justificatifNom ?? 'Aucun'}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
