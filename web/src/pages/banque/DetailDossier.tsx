import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ErreurApi } from '../../api';
import { Etat, GrandMontant, Jauge, ListeErreurs, erreursDe } from '../../composants';
import { useSession } from '../../session';
import {
  dateBreve,
  enDirhams,
  LIBELLE_DECISION,
  LIBELLE_EVENEMENT,
  LIBELLE_EXECUTION,
  libelleDossier,
  SEUIL_DECISION_CONSEILLER,
  SEUIL_JUSTIFICATIF,
  type DetailDossier as Detail,
  type Dossier,
  type ErreurDetaillee,
} from '../../types';
import { activationAReprendre } from './ListeDossiers';
import { ModeBanqueDemo } from './ModeBanqueDemo';

// Un dossier vu par le conseiller ou le superviseur, avec les actions que son état permet.
// L'écran ne propose que les actions attendues ; le serveur reste seul juge (R8, R9, R11…) et
// tout refus est affiché tel quel.

type Action = 'demander-complement' | 'approuver' | 'rejeter' | 'favorable' | 'defavorable';

const LIBELLE_ACTION: Record<Action, string> = {
  'demander-complement': 'Demander un complément',
  approuver: 'Approuver',
  rejeter: 'Rejeter',
  favorable: 'Recommander : avis favorable',
  defavorable: 'Recommander : avis défavorable',
};

export function DetailDossier() {
  const { id } = useParams();
  const { utilisateur } = useSession();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [motif, setMotif] = useState('');
  const [erreurs, setErreurs] = useState<ErreurDetaillee[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);

  const lire = useCallback(() => api.dossier(id!), [id]);

  useEffect(() => {
    lire()
      .then(setDetail)
      .catch((e: unknown) => setErreurs(erreursDe(e, 'Impossible de charger le dossier.')));
  }, [lire]);

  // Toute action : l'erreur est affichée, un conflit recharge le dossier, puis on relit tout.
  async function executer(message: string, action: () => Promise<unknown>, succes: string) {
    setEnvoi(message);
    setErreurs([]);
    setInfo(null);
    try {
      await action();
      setMotif('');
      setInfo(succes);
    } catch (e) {
      if (e instanceof ErreurApi && e.estUnConflit) {
        setInfo(
          `${e.message} Le dossier a été rechargé : vérifiez son état avant d’agir de nouveau.`,
        );
      } else {
        setErreurs(erreursDe(e));
      }
    } finally {
      setDetail(await lire().catch(() => detail));
      setEnvoi(null);
    }
  }

  function decider(d: Dossier, action: Action) {
    const appel = () =>
      action === 'favorable' || action === 'defavorable'
        ? api.recommander(d, action === 'favorable' ? 'FAVORABLE' : 'DEFAVORABLE', motif)
        : api.decider(d, action, motif);
    // L'approbation déclenche l'activation auprès de la banque, qui prend quelques secondes.
    const message = action === 'approuver' ? 'Approbation et appel à la banque…' : 'Envoi…';
    void executer(message, appel, `${LIBELLE_ACTION[action]} : enregistré.`);
  }

  if (!detail) {
    return erreurs.length > 0 ? (
      <ListeErreurs erreurs={erreurs} />
    ) : (
      <p className="chargement">Chargement…</p>
    );
  }

  const { demande, client, compte, revisions, decisions, historique } = detail;
  const roles = utilisateur?.roles ?? [];
  const libelle = libelleDossier(demande);
  const montant = demande.plafondDemande ?? 0;

  // Les actions attendues selon l'état, le rôle et le montant (R8, H5).
  const actions: Action[] = [];
  if (demande.statut === 'SOUMISE' && roles.includes('CONSEILLER')) {
    actions.push('demander-complement');
    actions.push(
      ...(montant <= SEUIL_DECISION_CONSEILLER
        ? (['approuver', 'rejeter'] as const)
        : (['favorable', 'defavorable'] as const)),
    );
  }
  if (demande.statut === 'ATTENTE_SUPERVISEUR' && roles.includes('SUPERVISEUR')) {
    actions.push('approuver', 'rejeter');
  }

  // Le plafond appliqué, déduit du statut : la banque applique le montant demandé seulement
  // quand la demande est active (une décision favorable ne suffit pas).
  const applique = demande.statut === 'ACTIVE' ? montant : compte.plafondInitial;
  const duree = (jours: number) => `${jours} jour${jours > 1 ? 's' : ''}`;
  const relance = activationAReprendre(demande);

  return (
    <>
      <nav className="fil" aria-label="Fil d’Ariane">
        <Link to="/banque">Dossiers</Link>
        <span aria-hidden="true">/</span>
        <span>{demande.reference}</span>
      </nav>
      <div className="entete enfants-haut">
        <div className="colonne ecart-8">
          <div className="titre-ligne">
            <h1 className="h1">{demande.reference}</h1>
            <Etat ton={libelle.ton}>{libelle.texte}</Etat>
          </div>
          <p className="muted">
            {client.nom}, compte {compte.numero}
          </p>
        </div>
      </div>
      {info && (
        <p className="message message-info marge-bas-24" role="status">
          {info}
        </p>
      )}

      <div className="g12">
        <div className="colonne span-8">
          <section className="coffre interieur-40" aria-label="Plafond demandé">
            <div className="coffre-haut">
              <div className="colonne ecart-12">
                <p className="coffre-label">Plafond demandé</p>
                <GrandMontant montant={montant} corps={72} />
              </div>
              <dl className="coffre-encart lignes encart-plafond">
                <div className="ligne ligne-serree">
                  <dt className="ligne-cle">Durée</dt>
                  <dd className="ligne-val">
                    {demande.dureeJours === null ? '' : duree(demande.dureeJours)}
                  </dd>
                </div>
                <div className="ligne ligne-serree">
                  <dt className="ligne-cle">Appliqué aujourd’hui</dt>
                  <dd className="ligne-val">{enDirhams(applique)}</dd>
                </div>
              </dl>
            </div>
            <div className="marge-haut-24">
              <Jauge plafondInitial={compte.plafondInitial} applique={applique} demande={montant} />
            </div>
            <div className="coffre-sep marge-v-24" />
            <div className="seuils">
              <p>
                <span className="poids-500">
                  {montant <= SEUIL_DECISION_CONSEILLER
                    ? 'Jusqu’à 30 000 DH'
                    : 'Au-delà de 30 000 DH'}
                </span>
                <span className="muted">
                  {montant <= SEUIL_DECISION_CONSEILLER
                    ? ', le conseiller décide'
                    : ', le superviseur décide sur recommandation'}
                </span>
              </p>
              <p>
                <span className="poids-500">
                  {montant <= SEUIL_JUSTIFICATIF ? 'Jusqu’à 50 000 DH' : 'Au-delà de 50 000 DH'}
                </span>
                <span className="muted">
                  {montant <= SEUIL_JUSTIFICATIF
                    ? ', justificatif facultatif'
                    : ', justificatif obligatoire'}
                </span>
              </p>
            </div>
          </section>

          <section className="panel interieur-32" aria-label="Informations">
            <div className="deux-col ecart-40">
              <div className="colonne ecart-16">
                <h2 className="h3">Client</h2>
                <dl className="lignes">
                  <div className="ligne">
                    <dt className="ligne-cle">Client</dt>
                    <dd className="ligne-val">{client.nom}</dd>
                  </div>
                  <div className="ligne">
                    <dt className="ligne-cle">Dossier client</dt>
                    <dd className="ligne-val">
                      {client.dossierComplet ? 'Complet' : <Etat ton="action">Incomplet</Etat>}
                    </dd>
                  </div>
                  <div className="ligne">
                    <dt className="ligne-cle">Compte</dt>
                    <dd className="ligne-val">{compte.numero}</dd>
                  </div>
                  <div className="ligne">
                    <dt className="ligne-cle">Plafond habituel</dt>
                    <dd className="ligne-val">{enDirhams(compte.plafondInitial)}</dd>
                  </div>
                </dl>
              </div>
              <div className="colonne ecart-16">
                <h2 className="h3">Dossier</h2>
                <dl className="lignes">
                  <div className="ligne">
                    <dt className="ligne-cle">Motif du client</dt>
                    <dd className="ligne-val texte-libre">{demande.motif}</dd>
                  </div>
                  <div className="ligne">
                    <dt className="ligne-cle">Justificatif</dt>
                    <dd className="ligne-val">
                      {demande.justificatifPresent ? (
                        <a className="lien" href={api.lienJustificatifDossier(demande.id)}>
                          {demande.justificatifNom ?? 'Télécharger'}
                        </a>
                      ) : (
                        'Aucun'
                      )}
                    </dd>
                  </div>
                  <div className="ligne">
                    <dt className="ligne-cle">Version</dt>
                    <dd className="ligne-val">v{demande.revisionCourante}</dd>
                  </div>
                  {demande.submittedAt && (
                    <div className="ligne">
                      <dt className="ligne-cle">Soumise le</dt>
                      <dd className="ligne-val">{dateBreve(demande.submittedAt)}</dd>
                    </div>
                  )}
                  {demande.dateActivation && (
                    <div className="ligne">
                      <dt className="ligne-cle">Actif depuis</dt>
                      <dd className="ligne-val">{dateBreve(demande.dateActivation)}</dd>
                    </div>
                  )}
                  {demande.dateEcheance && (
                    <div className="ligne">
                      <dt className="ligne-cle">Échéance</dt>
                      <dd className="ligne-val">{dateBreve(demande.dateEcheance)}</dd>
                    </div>
                  )}
                  {demande.desactivationStatut && (
                    <div className="ligne">
                      <dt className="ligne-cle">Désactivation</dt>
                      <dd className="ligne-val">
                        {LIBELLE_EXECUTION[demande.desactivationStatut]}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </section>

          {decisions.length > 0 && (
            <section className="panel colonne interieur-32" aria-labelledby="decisions-titre">
              <h2 id="decisions-titre" className="h3">
                Décisions et recommandations
              </h2>
              <ul className="lignes">
                {[...decisions].reverse().map((d, i) => (
                  <li key={i} className="colonne entree ecart-8">
                    <div className="entree-tete retour-ligne">
                      <Etat
                        ton={
                          d.type === 'REJET' || d.type === 'RECOMMANDATION_DEFAVORABLE'
                            ? 'refus'
                            : 'neutre'
                        }
                      >
                        {LIBELLE_DECISION[d.type] ?? d.type}
                      </Etat>
                      <span className="t13 muted">
                        {d.acteur}, {d.role === 'SUPERVISEUR' ? 'superviseur' : 'conseiller'}, sur
                        la v{d.revisionNo}, le {dateBreve(d.decideeLe)}
                      </span>
                    </div>
                    <p className="t15 texte-libre motif-decision">{d.motif}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="deux-col">
            <section
              className="panel colonne interieur-32 ecart-16"
              aria-labelledby="versions-titre"
            >
              <h2 id="versions-titre" className="h3">
                Versions
              </h2>
              {revisions.length === 0 && <p className="muted">Aucune version soumise.</p>}
              {[...revisions].reverse().map((r) => (
                <div key={r.revisionNo} className="colonne version-carte">
                  <div className="entree-tete">
                    <span className="poids-600">v{r.revisionNo}</span>
                    <span className="t13 muted">{dateBreve(r.soumiseLe)}</span>
                  </div>
                  <p className="muted">
                    {enDirhams(r.plafondDemande)}, {duree(r.dureeJours)},{' '}
                    {r.justificatifNom ? `justificatif ${r.justificatifNom}` : 'sans justificatif'}
                  </p>
                  <p className="t15 texte-libre">{r.motif}</p>
                </div>
              ))}
            </section>
            <section
              className="panel colonne interieur-32 ecart-16"
              aria-labelledby="historique-titre"
            >
              <h2 id="historique-titre" className="h3">
                Historique
              </h2>
              <ol className="historique">
                {[...historique].reverse().map((h, i) => (
                  <li key={i} className="histo">
                    <span className="histo-date">{dateBreve(h.date)}</span>
                    <span>
                      {LIBELLE_EVENEMENT[h.action] ?? h.action}
                      {h.acteur && `, ${h.acteur}`}
                      {h.viaAgent && ' (via l’assistant)'}
                      {h.motif && <span className="t13 muted texte-libre bloc">{h.motif}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>

        <div className="colonne span-4">
          {actions.length > 0 && (
            <aside className="panel colonne interieur-32 ecart-24" aria-labelledby="decision-titre">
              <div className="colonne ecart-8">
                <p className="surtitre">Votre action</p>
                <h2 id="decision-titre" className="h2">
                  Décision
                </h2>
                <p className="muted">
                  {demande.statut === 'ATTENTE_SUPERVISEUR'
                    ? 'Au-delà de 30 000 DH, le superviseur décide.'
                    : montant <= SEUIL_DECISION_CONSEILLER
                      ? 'Jusqu’à 30 000 DH, vous décidez.'
                      : 'Au-delà de 30 000 DH, vous transmettez le dossier avec votre recommandation.'}
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
                  onChange={(e) => setMotif(e.target.value)}
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
                    onClick={() => decider(demande, action)}
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
                Une décision favorable n’active pas le plafond : il n’est actif qu’une fois appliqué
                par la banque.
              </p>
            </aside>
          )}

          {relance && (
            <aside
              className="panel colonne interieur-32 ecart-24"
              aria-labelledby="activation-titre"
            >
              <div className="colonne ecart-12">
                <h2 id="activation-titre" className="h2">
                  Activation
                </h2>
                <Etat ton="action">{libelle.texte}</Etat>
              </div>
              <dl className="lignes">
                <div className="ligne ligne-serree">
                  <dt className="ligne-cle">Décision favorable</dt>
                  <dd className="ligne-val">
                    {enDirhams(montant)}
                    {demande.dureeJours !== null && `, ${duree(demande.dureeJours)}`}
                  </dd>
                </div>
                <div className="ligne ligne-serree">
                  <dt className="ligne-cle">Plafond appliqué par la banque</dt>
                  <dd className="ligne-val">{enDirhams(compte.plafondInitial)}, inchangé</dd>
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
              {actions.length === 0 && <ListeErreurs erreurs={erreurs} />}
              <button
                type="button"
                className="btn btn-primaire btn-plein"
                disabled={envoi !== null}
                onClick={() =>
                  void executer(
                    'Appel à la banque…',
                    () => api.relancer(demande),
                    'Relance effectuée.',
                  )
                }
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
                La décision reste acquise : seule l’activation par la banque est relancée, et la
                banque ne l’applique jamais deux fois.
              </p>
            </aside>
          )}

          {actions.length === 0 && !relance && (
            <aside className="panel interieur-32">
              <h2 className="h3 marge-bas-8">Décision</h2>
              <p className="muted">Aucune décision n’est attendue de vous sur ce dossier.</p>
            </aside>
          )}
        </div>
      </div>
    </>
  );
}
