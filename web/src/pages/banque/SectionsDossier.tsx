import { api } from '../../api';
import { Etat, GrandMontant, Jauge } from '../../composants';
import {
  dateBreve,
  enDirhams,
  enJours,
  LIBELLE_DECISION,
  LIBELLE_EVENEMENT,
  LIBELLE_EXECUTION,
  SEUIL_DECISION_CONSEILLER,
  SEUIL_JUSTIFICATIF,
  type DetailDossier as Detail,
} from '../../types';

// Les sections d'un dossier vu par la banque. Elles ne font qu'afficher ce que l'API renvoie ;
// les actions et leur état restent dans la page (DetailDossier).

type Demande = Detail['demande'];

// Le plafond demandé, ce que la banque applique aujourd'hui, et qui décide à ce montant.
export function SectionPlafond({
  demande,
  plafondInitial,
  applique,
}: {
  demande: Demande;
  plafondInitial: number;
  applique: number;
}) {
  const montant = demande.plafondDemande ?? 0;
  return (
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
              {demande.dureeJours === null ? '' : enJours(demande.dureeJours)}
            </dd>
          </div>
          <div className="ligne ligne-serree">
            <dt className="ligne-cle">Appliqué aujourd’hui</dt>
            <dd className="ligne-val">{enDirhams(applique)}</dd>
          </div>
        </dl>
      </div>
      <div className="marge-haut-24">
        <Jauge plafondInitial={plafondInitial} applique={applique} demande={montant} />
      </div>
      <div className="coffre-sep marge-v-24" />
      <div className="seuils">
        <p>
          <span className="poids-500">
            {montant <= SEUIL_DECISION_CONSEILLER
              ? `Jusqu’à ${enDirhams(SEUIL_DECISION_CONSEILLER)}`
              : `Au-delà de ${enDirhams(SEUIL_DECISION_CONSEILLER)}`}
          </span>
          <span className="muted">
            {montant <= SEUIL_DECISION_CONSEILLER
              ? ', le conseiller décide'
              : ', le superviseur décide sur recommandation'}
          </span>
        </p>
        <p>
          <span className="poids-500">
            {montant <= SEUIL_JUSTIFICATIF
              ? `Jusqu’à ${enDirhams(SEUIL_JUSTIFICATIF)}`
              : `Au-delà de ${enDirhams(SEUIL_JUSTIFICATIF)}`}
          </span>
          <span className="muted">
            {montant <= SEUIL_JUSTIFICATIF
              ? ', justificatif facultatif'
              : ', justificatif obligatoire'}
          </span>
        </p>
      </div>
    </section>
  );
}

// Le client, son compte, et les éléments du dossier (motif, justificatif, dates).
export function SectionInformations({
  demande,
  client,
  compte,
}: Pick<Detail, 'demande' | 'client' | 'compte'>) {
  return (
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
                <dd className="ligne-val">{LIBELLE_EXECUTION[demande.desactivationStatut]}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </section>
  );
}

// Les décisions et recommandations, de la plus récente à la plus ancienne.
export function SectionDecisions({ decisions }: Pick<Detail, 'decisions'>) {
  if (decisions.length === 0) {
    return null;
  }
  return (
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
                  d.type === 'REJET' || d.type === 'RECOMMANDATION_DEFAVORABLE' ? 'refus' : 'neutre'
                }
              >
                {LIBELLE_DECISION[d.type] ?? d.type}
              </Etat>
              <span className="t13 muted">
                {d.acteur}, {d.role === 'SUPERVISEUR' ? 'superviseur' : 'conseiller'}, sur la v
                {d.revisionNo}, le {dateBreve(d.decideeLe)}
              </span>
            </div>
            <p className="t15 texte-libre motif-decision">{d.motif}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Les révisions soumises (v1, v2…), figées, de la plus récente à la plus ancienne.
export function SectionVersions({ revisions }: Pick<Detail, 'revisions'>) {
  return (
    <section className="panel colonne interieur-32 ecart-16" aria-labelledby="versions-titre">
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
            {enDirhams(r.plafondDemande)}, {enJours(r.dureeJours)},{' '}
            {r.justificatifNom ? `justificatif ${r.justificatifNom}` : 'sans justificatif'}
          </p>
          <p className="t15 texte-libre">{r.motif}</p>
        </div>
      ))}
    </section>
  );
}

// L'historique du dossier (table events), du plus récent au plus ancien.
export function SectionHistorique({ historique }: Pick<Detail, 'historique'>) {
  return (
    <section className="panel colonne interieur-32 ecart-16" aria-labelledby="historique-titre">
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
  );
}
