import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ErreurApi } from '../../api';
import { ListeErreurs, erreursDe } from '../../composants';
import { useSession } from '../../session';
import {
  dateLisible,
  enDirhams,
  LIBELLE_DECISION,
  LIBELLE_EXECUTION,
  libelleDossier,
  SEUIL_DECISION_CONSEILLER,
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
      <p className="discret">Chargement…</p>
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

  return (
    <>
      <p>
        <Link to="/banque">Tous les dossiers</Link>
      </p>
      <h1>Dossier {demande.reference}</h1>
      {info && (
        <p className="message message-info" role="status">
          {info}
        </p>
      )}

      <section className={`etat etat-${libelle.ton}`}>
        <p className="etat-libelle">{libelle.texte}</p>
        {demande.derniereErreur && <p>Dernière erreur de la banque : {demande.derniereErreur}</p>}
        {demande.desactivationStatut && (
          <p>Désactivation {LIBELLE_EXECUTION[demande.desactivationStatut]}</p>
        )}
      </section>

      <dl className="recapitulatif">
        <dt>Client</dt>
        <dd>
          {client.nom}
          {!client.dossierComplet && ' (dossier client incomplet)'}
        </dd>
        <dt>Compte</dt>
        <dd>
          {compte.numero}, plafond initial{' '}
          <span className="chiffres">{enDirhams(compte.plafondInitial)}</span>
        </dd>
        <dt>Plafond demandé</dt>
        <dd className="chiffres">
          {demande.plafondDemande === null ? '' : enDirhams(demande.plafondDemande)}
        </dd>
        <dt>Durée</dt>
        <dd>
          {demande.dureeJours} jour{(demande.dureeJours ?? 0) > 1 ? 's' : ''}
        </dd>
        <dt>Motif du client</dt>
        <dd className="texte-libre">{demande.motif}</dd>
        <dt>Justificatif</dt>
        <dd>
          {demande.justificatifPresent ? (
            <a href={api.lienJustificatifDossier(demande.id)}>
              {demande.justificatifNom ?? 'Télécharger'}
            </a>
          ) : (
            'Aucun'
          )}
        </dd>
        <dt>Version</dt>
        <dd>v{demande.revisionCourante}</dd>
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
      </dl>

      {actions.length > 0 && (
        <section className="panneau-decision">
          <h2>Décision</h2>
          {demande.statut === 'SOUMISE' && montant > SEUIL_DECISION_CONSEILLER && (
            <p className="discret">
              Au-delà de {enDirhams(SEUIL_DECISION_CONSEILLER)}, la décision revient au superviseur
              : vous transmettez le dossier avec votre recommandation.
            </p>
          )}
          <label className="formulaire">
            Motif, communiqué avec la décision
            <textarea
              rows={3}
              maxLength={2000}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
            />
          </label>
          <ListeErreurs erreurs={erreurs} />
          <div className="actions">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                className={
                  action === 'rejeter' || action === 'defavorable'
                    ? 'bouton bouton-secondaire'
                    : 'bouton'
                }
                disabled={envoi !== null || motif.trim() === ''}
                onClick={() => decider(demande, action)}
              >
                {LIBELLE_ACTION[action]}
              </button>
            ))}
          </div>
          {motif.trim() === '' && (
            <p className="discret">Le motif est obligatoire pour toute décision.</p>
          )}
          {envoi && (
            <p className="discret" role="status">
              {envoi}
            </p>
          )}
        </section>
      )}

      {activationAReprendre(demande) && (
        <section className="panneau-decision">
          <h2>Activation</h2>
          <p>
            La décision est favorable, mais le plafond n’est pas encore actif : l’activation est{' '}
            {LIBELLE_EXECUTION[demande.activationStatut!]}. La relance rejoue la même opération ; la
            banque ne l’applique jamais deux fois.
          </p>
          <ModeBanqueDemo />
          {actions.length === 0 && <ListeErreurs erreurs={erreurs} />}
          <button
            type="button"
            className="bouton"
            disabled={envoi !== null}
            onClick={() =>
              void executer('Appel à la banque…', () => api.relancer(demande), 'Relance effectuée.')
            }
          >
            Relancer l’activation
          </button>
          {envoi && (
            <p className="discret" role="status">
              {envoi}
            </p>
          )}
        </section>
      )}

      {decisions.length > 0 && (
        <section>
          <h2>Décisions et recommandations</h2>
          <ol className="chronologie">
            {decisions.map((d, i) => (
              <li key={i}>
                <p>
                  <strong>{LIBELLE_DECISION[d.type] ?? d.type}</strong> par {d.acteur} (
                  {d.role === 'SUPERVISEUR' ? 'superviseur' : 'conseiller'}), sur la v{d.revisionNo}
                  , le {dateLisible(d.decideeLe)}
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
                  <strong>v{r.revisionNo}</strong>, le {dateLisible(r.soumiseLe)} :{' '}
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

      <section>
        <h2>Historique</h2>
        <ol className="chronologie historique">
          {historique.map((h, i) => (
            <li key={i}>
              <p>
                <span className="discret">{dateLisible(h.date)}</span> {h.action}
                {h.acteur && `, ${h.acteur}`}
                {h.viaAgent && ' (via l’assistant)'}
              </p>
              {h.motif && <p className="texte-libre discret">{h.motif}</p>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
