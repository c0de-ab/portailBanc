import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
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
import { ListeErreurs } from '../../composants';

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
  const [echanges, setEchanges] = useState<Echange[]>([]);
  const [message, setMessage] = useState('');
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
      <p>
        <Link to="/client">Mes plafonds</Link>
      </p>
      <h1>Assistant</h1>
      <p className="chapeau">
        L’assistant consulte vos comptes et prépare un brouillon. Il ne soumet jamais rien : vous
        confirmez vous-même, et votre conseiller décide.
      </p>

      <ol className="conversation" aria-live="polite">
        {echanges.map((echange, i) => (
          <li key={i} className={`echange echange-${echange.de}`}>
            {echange.de === 'client' && <p className="bulle-client texte-libre">{echange.texte}</p>}
            {echange.de === 'indisponible' && (
              <div className="message message-erreur">
                <p>{echange.texte}</p>
                <p>
                  <Link to="/client">Revenir à mes plafonds</Link>
                </p>
              </div>
            )}
            {echange.de === 'agent' &&
              echange.elements.map((element, j) => <Element key={j} element={element} />)}
          </li>
        ))}
        {envoi && <li className="discret">L’assistant répond…</li>}
      </ol>

      {echanges.length === 0 && (
        <div className="exemples">
          <p className="discret">Par exemple :</p>
          {EXEMPLES.map((exemple) => (
            <button
              key={exemple}
              type="button"
              className="exemple"
              onClick={() => void envoyer(exemple)}
            >
              {exemple}
            </button>
          ))}
        </div>
      )}

      <form className="saisie-message" onSubmit={soumettreFormulaire}>
        <label htmlFor="message">Votre message</label>
        <textarea
          id="message"
          rows={2}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void envoyer(message);
            }
          }}
        />
        <button type="submit" className="bouton" disabled={envoi || message.trim() === ''}>
          Envoyer
        </button>
      </form>
    </>
  );
}

function Element({ element }: { element: ElementAgent }) {
  switch (element.type) {
    case 'explication':
      return (
        <div className="explication">
          <p className="nature">Réponse de l’assistant, à vérifier</p>
          <p className="texte-libre">{element.texte}</p>
        </div>
      );
    case 'action':
      return (
        <div className="action-realisee">
          <p className="nature">Action réalisée</p>
          <p>
            {element.texte}{' '}
            <Link to={`/client/demandes/${element.demandeId}`}>Voir la demande</Link>
          </p>
        </div>
      );
    case 'donnee':
      return (
        <div className="donnee">
          <p className="nature">Donnée du système : {NOM_OUTIL[element.outil] ?? element.outil}</p>
          <Donnee outil={element.outil} contenu={element.contenu} />
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
            <li key={i}>{e.message}</li>
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
            {compte.demandeEnCours && `, une demande en cours`}
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
      <>
        <p>
          {d.reference ?? 'Brouillon'} : {libelleClient(d).texte}
        </p>
        <p className="chiffres">
          {d.plafondDemande === null ? 'Plafond non renseigné' : enDirhams(d.plafondDemande)},{' '}
          {d.dureeJours === null
            ? 'durée non renseignée'
            : `${d.dureeJours} jour${d.dureeJours > 1 ? 's' : ''}`}
          {d.justificatifNom && `, justificatif ${d.justificatifNom}`}
        </p>
        {avertissements.length > 0 && (
          <>
            <p>Reste à compléter avant de soumettre :</p>
            <ul>
              {avertissements.map((a) => (
                <li key={`${a.code}-${a.champ ?? ''}`}>{a.message}</li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }
  return <pre className="texte-libre">{JSON.stringify(contenu, null, 2)}</pre>;
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
    <div className="carte-confirmation">
      <p className="nature">À confirmer par vous</p>
      <dl className="recapitulatif">
        <dt>Plafond demandé</dt>
        <dd className="chiffres">{enDirhams(carte.plafondDemande)}</dd>
        <dt>Durée</dt>
        <dd>
          {carte.dureeJours} jour{carte.dureeJours > 1 ? 's' : ''}
        </dd>
        <dt>Motif</dt>
        <dd className="texte-libre">{carte.motif}</dd>
        <dt>Justificatif</dt>
        <dd>{carte.justificatifNom ?? 'Aucun'}</dd>
      </dl>
      <ListeErreurs erreurs={erreurs} />
      {etat === 'soumise' ? (
        <p role="status">
          Demande soumise. <Link to={`/client/demandes/${carte.demandeId}`}>Suivre la demande</Link>
        </p>
      ) : (
        <button
          type="button"
          className="bouton"
          disabled={etat === 'envoi'}
          onClick={() => void confirmer()}
        >
          {etat === 'envoi' ? 'Envoi…' : 'Confirmer et soumettre'}
        </button>
      )}
    </div>
  );
}
