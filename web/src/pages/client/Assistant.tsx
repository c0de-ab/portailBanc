import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { api, ErreurApi } from '../../api';
import {
  enDirhams,
  libelleClient,
  type CarteConfirmation,
  type Compte,
  type Demande,
  type ElementAgent,
  type ErreurDetaillee,
} from '../../types';
import { Etat, GrandMontant, ListeErreurs } from '../../composants';

// Le chat du client avec l'agent. Trois natures de message, présentées différemment :
// - donnée du système : le résultat d'un outil, lu en base par le serveur ;
// - explication : le texte du modèle, NON FIABLE (il peut être influencé par un message) ;
// - action réalisée : ce que le serveur a effectivement fait.
// Tout est affiché comme du texte, jamais comme du HTML. L'agent ne soumet jamais : seule la
// carte de confirmation, cliquée par le client, appelle la route de soumission (R7).

type Echange =
  | { de: 'client'; texte: string }
  | { de: 'agent'; elements: ElementAgent[] }
  | { de: 'indisponible'; texte: string };

const EXEMPLES = [
  'Quel est mon plafond actuel ?',
  'Je voudrais 25 000 DH pendant 3 jours, motif : achat d’une voiture',
  'Où en est ma demande ?',
];

export function Assistant() {
  // Une question choisie sur le tableau de bord arrive déjà saisie ; le client l'envoie lui-même.
  const questionProposee = (useLocation().state as { question?: string } | null)?.question ?? '';
  const [echanges, setEchanges] = useState<Echange[]>([]);
  const [message, setMessage] = useState(questionProposee);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(texte: string) {
    const propre = texte.trim();
    if (propre === '' || envoi) {
      return;
    }
    setEchanges((e) => [...e, { de: 'client', texte: propre }]);
    setMessage('');
    setEnvoi(true);
    try {
      const { elements } = await api.envoyerMessage(propre);
      setEchanges((e) => [...e, { de: 'agent', elements }]);
    } catch (e) {
      const texteErreur =
        e instanceof ErreurApi && e.statut === 503
          ? 'L’assistant est indisponible pour le moment. Vous pouvez faire votre demande avec le formulaire, qui reste utilisable.'
          : e instanceof ErreurApi
            ? e.message
            : 'Le serveur est injoignable.';
      setEchanges((x) => [...x, { de: 'indisponible', texte: texteErreur }]);
    } finally {
      setEnvoi(false);
    }
  }

  function soumettreFormulaire(evenement: FormEvent) {
    evenement.preventDefault();
    void envoyer(message);
  }

  return (
    <>
      <div className="entete">
        <div className="colonne ecart-8">
          <h1 className="h1">Assistant</h1>
          <p className="muted">
            L’assistant consulte vos comptes et prépare un brouillon. Il ne soumet jamais rien :
            vous confirmez vous-même, et votre conseiller décide.
          </p>
        </div>
      </div>

      <div className="g12">
        <section className="panel conversation span-8" aria-label="Conversation avec l’assistant">
          <ol className="fil-messages interieur-large" aria-live="polite">
            {echanges.length === 0 && (
              <li className="muted">Posez votre question, ou choisissez une suggestion.</li>
            )}
            {echanges.map((echange, i) => (
              <li key={i} className="fil-messages">
                {echange.de === 'client' && (
                  <div className="msg-client">
                    <p className="msg-entete">Vous</p>
                    <div className="bulle-msg texte-libre">{echange.texte}</div>
                  </div>
                )}
                {echange.de === 'indisponible' && (
                  <div className="bandeau-neutre barre-actions bandeau-indisponible" role="status">
                    <div className="indisponible-texte">
                      <span className="point point-neutre marge-haut-8" />
                      <p className="t17 poids-500">{echange.texte}</p>
                    </div>
                    <Link className="btn btn-primaire" to="/client">
                      Revenir à mes plafonds
                    </Link>
                  </div>
                )}
                {echange.de === 'agent' &&
                  echange.elements.map((element, j) => <Element key={j} element={element} />)}
              </li>
            ))}
            {envoi && <li className="muted">L’assistant répond…</li>}
          </ol>

          <div className="colonne zone-saisie">
            {echanges.length === 0 && (
              <div className="suggestions" role="group" aria-label="Suggestions de questions">
                {EXEMPLES.map((exemple) => (
                  <button
                    key={exemple}
                    type="button"
                    className="suggestion"
                    onClick={() => void envoyer(exemple)}
                  >
                    {exemple}
                  </button>
                ))}
              </div>
            )}
            <form className="composer" onSubmit={soumettreFormulaire}>
              <div className="champ extensible">
                <label className="etiquette" htmlFor="message">
                  Votre message
                </label>
                <textarea
                  id="message"
                  className="saisie saisie-message"
                  rows={2}
                  maxLength={2000}
                  placeholder="Posez votre question"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void envoyer(message);
                    }
                  }}
                />
              </div>
              <button
                type="submit"
                className="btn btn-primaire"
                disabled={envoi || message.trim() === ''}
              >
                Envoyer
              </button>
            </form>
          </div>
        </section>

        <aside className="colonne span-4" aria-labelledby="legende-titre">
          <section className="panel interieur-32">
            <p className="surtitre">Repères</p>
            <h2 id="legende-titre" className="h3 titre-reperes">
              Lire les messages
            </h2>
            <ul className="colonne ecart-0">
              <li className="specimen">
                <span className="echantillon echantillon-client" aria-hidden="true" />
                <span>
                  <span className="specimen-nom">Vous</span>
                  <span className="t13 muted">Vos messages.</span>
                </span>
              </li>
              <li className="specimen">
                <span className="echantillon echantillon-donnee" aria-hidden="true">
                  <span className="echantillon-donnee-entete" />
                </span>
                <span>
                  <span className="specimen-nom">Donnée du système</span>
                  <span className="t13 muted">Lue en base. Elle fait foi.</span>
                </span>
              </li>
              <li className="specimen">
                <span className="echantillon echantillon-ia" aria-hidden="true" />
                <span>
                  <span className="specimen-nom">Réponse de l’assistant, à vérifier</span>
                  <span className="t13 muted">Texte rédigé par le modèle. Il peut se tromper.</span>
                </span>
              </li>
              <li className="specimen">
                <span className="echantillon echantillon-action" aria-hidden="true">
                  <span className="echantillon-trait" />
                  <span className="coche">{COCHE_ENCRE}</span>
                  <span className="echantillon-trait" />
                </span>
                <span>
                  <span className="specimen-nom">Action réalisée</span>
                  <span className="t13 muted">Ce que le système vient de faire.</span>
                </span>
              </li>
              <li className="specimen">
                <span className="echantillon echantillon-carte" aria-hidden="true">
                  <span className="point point-carte" />
                </span>
                <span>
                  <span className="specimen-nom">À confirmer par vous</span>
                  <span className="t13 muted">Rien n’est soumis sans votre clic.</span>
                </span>
              </li>
            </ul>
          </section>
          <section className="panel colonne interieur-32 ecart-16">
            <p className="t15 muted">
              Vous pouvez aussi faire votre demande vous-même, sans l’assistant.
            </p>
            <Link className="btn btn-secondaire aligne-debut" to="/client">
              Aller à mes plafonds
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}

const COCHE_ENCRE = (
  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
    <path
      d="M2.5 6.2 4.8 8.5 9.5 3.5"
      fill="none"
      stroke="#16202A"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function Element({ element }: { element: ElementAgent }) {
  switch (element.type) {
    case 'explication':
      return (
        <div className="msg-ia" role="group" aria-label="Réponse de l’assistant, à vérifier">
          <p className="msg-entete">Réponse de l’assistant, à vérifier</p>
          <div className="bulle-msg texte-libre">{element.texte}</div>
        </div>
      );
    case 'action':
      return (
        <div className="msg-action" role="status">
          <span className="action-corps">
            <span className="coche" aria-hidden="true">
              {COCHE_ENCRE}
            </span>
            <span className="t13 muted poids-500">Action réalisée</span>
            <span>{element.texte}</span>
            <Link className="lien" to={`/client/demandes/${element.demandeId}`}>
              Voir la demande
            </Link>
          </span>
        </div>
      );
    case 'donnee':
      return (
        <div className="msg-donnee" role="group" aria-label="Donnée du système">
          <div className="donnee-entete">
            <span>Donnée du système : {NOM_OUTIL[element.outil] ?? element.outil}</span>
            <span className="muted poids-400">Lue en base, fait foi</span>
          </div>
          <div className="donnee-corps">
            <Donnee outil={element.outil} contenu={element.contenu} />
          </div>
        </div>
      );
    case 'confirmation':
      return <Carte carte={element.carte} />;
  }
}

const NOM_OUTIL: Record<string, string> = {
  consulter_comptes: 'vos comptes',
  consulter_dossier: 'vos demandes',
  preparer_brouillon: 'le brouillon enregistré',
  proposer_soumission: 'la vérification avant soumission',
};

// Chaque outil a son affichage ; un contenu inattendu est montré tel quel, comme du texte.
function Donnee({ outil, contenu }: { outil: string; contenu: unknown }) {
  const c = contenu as Record<string, unknown>;
  if (Array.isArray(c?.erreurs)) {
    return (
      <>
        <p>Refusé par le serveur, rien n’a été modifié :</p>
        <ul>
          {(c.erreurs as ErreurDetaillee[]).map((e, i) => (
            <li key={i} className="t15 poids-400">
              {e.message}
            </li>
          ))}
        </ul>
      </>
    );
  }
  if (outil === 'consulter_comptes' && Array.isArray(c.comptes)) {
    return (
      <ul>
        {(c.comptes as Compte[]).map((compte) => (
          <li key={compte.id}>
            Compte {compte.numero} : plafond appliqué {enDirhams(compte.plafondCourant)}
            {compte.plafondTemporaireActif
              ? ` (temporaire, plafond habituel ${enDirhams(compte.plafondInitial)})`
              : ' (plafond habituel)'}
            {compte.demandeEnCours && ', une demande en cours'}
          </li>
        ))}
        {c.dossierComplet === false && (
          <li>Dossier client incomplet : aucune demande ne peut être soumise.</li>
        )}
      </ul>
    );
  }
  if (outil === 'consulter_dossier' && Array.isArray(c.demandes)) {
    const demandes = c.demandes as Demande[];
    return demandes.length === 0 ? (
      <p>Aucune demande.</p>
    ) : (
      <ul>
        {demandes.map((d) => (
          <li key={d.id}>
            {d.reference ?? 'Brouillon'} : {libelleClient(d).texte}
          </li>
        ))}
      </ul>
    );
  }
  if ((outil === 'consulter_dossier' || outil === 'preparer_brouillon') && c.demande) {
    const d = c.demande as Demande;
    const avertissements = (c.avertissements as ErreurDetaillee[] | undefined) ?? [];
    return (
      <div className="colonne ecart-8">
        <p>
          {d.reference ?? 'Brouillon'} : {libelleClient(d).texte}
        </p>
        <p className="t15 muted poids-400">
          {d.plafondDemande === null ? 'Plafond non renseigné' : enDirhams(d.plafondDemande)},{' '}
          {d.dureeJours === null
            ? 'durée non renseignée'
            : `${d.dureeJours} jour${d.dureeJours > 1 ? 's' : ''}`}
          {d.justificatifNom && `, justificatif ${d.justificatifNom}`}
        </p>
        {avertissements.length > 0 && (
          <div className="message message-avertissement">
            <p className="poids-500">Reste à compléter avant de soumettre</p>
            <ul>
              {avertissements.map((a) => (
                <li key={`${a.code}-${a.champ ?? ''}`}>{a.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  return <pre>{JSON.stringify(contenu, null, 2)}</pre>;
}

// La carte de confirmation : même récapitulatif et même route que le formulaire. La version de
// la carte est transmise sans être affichée ; si la demande a changé depuis, le serveur refuse (R7).
function Carte({ carte }: { carte: CarteConfirmation }) {
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
          : e instanceof ErreurApi
            ? e.erreurs
            : [{ code: 'INCONNUE', message: 'Le serveur est injoignable.' }],
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
            <GrandMontant montant={carte.plafondDemande} corps={64} />
          </div>
          <dl className="coffre-encart faits faits-ligne carte-faits">
            <div>
              <dt>Durée</dt>
              <dd>
                {carte.dureeJours} jour{carte.dureeJours > 1 ? 's' : ''}
              </dd>
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
