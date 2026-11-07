import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ErreurApi } from '../../api';
import { useAssistant } from '../../assistant';
import { useSession } from '../../session';
import {
  enDirhams,
  enJours,
  libelleClient,
  type CarteConfirmation,
  type Compte,
  type Demande,
  type ElementAgent,
  type ErreurDetaillee,
} from '../../types';
import { erreursDe, Etat, GrandMontant, ListeErreurs } from '../../composants';

// Le chat du client avec l'agent, dans un panneau ouvert à côté de la page en cours. Trois
// natures de message, présentées différemment :
// - donnée du système : le résultat d'un outil, lu en base par le serveur ;
// - explication : le texte du modèle, NON FIABLE (il peut être influencé par un message) ;
// - action réalisée : ce que le serveur a effectivement fait.
// Tout est affiché comme du texte, jamais comme du HTML. L'agent ne soumet jamais : seule la
// carte de confirmation, cliquée par le client, appelle la route de soumission (R7).

const EXEMPLES = [
  'Quel est mon plafond actuel ?',
  'Je voudrais 25 000 DH pendant 3 jours, motif : achat d’une voiture',
  'Où en est ma demande ?',
];

export function PanneauAssistant() {
  const { ouvert, fermer, effacer, echanges, envoi, message, setMessage, envoyer } = useAssistant();
  const initiale = useSession().utilisateur?.displayName.charAt(0) ?? '';
  const saisie = useRef<HTMLTextAreaElement>(null);
  const fil = useRef<HTMLOListElement>(null);
  // L'aide « Lire les messages », dépliée par le bouton « i » à côté du titre.
  const [reperes, setReperes] = useState(false);

  // À l'ouverture, le curseur va dans le champ de saisie.
  useEffect(() => {
    if (ouvert) {
      saisie.current?.focus();
    }
  }, [ouvert]);

  // La touche Échap ferme le panneau.
  useEffect(() => {
    if (!ouvert) {
      return;
    }
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        fermer();
      }
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [ouvert, fermer]);

  // Le dernier message reste visible.
  useEffect(() => {
    if (fil.current) {
      fil.current.scrollTop = fil.current.scrollHeight;
    }
  }, [echanges, envoi, ouvert]);

  function soumettreFormulaire(evenement: FormEvent) {
    evenement.preventDefault();
    void envoyer(message);
  }

  // Fermé, le panneau est masqué mais reste en place : les cartes déjà confirmées gardent leur état.
  return (
    <aside
      id="panneau-assistant"
      className="panneau-assistant"
      aria-labelledby="assistant-titre"
      hidden={!ouvert}
    >
      <header className="panneau-entete">
        <div className="panneau-titre">
          <h2 id="assistant-titre" className="h3">
            Assistant
          </h2>
          <button
            type="button"
            className="panneau-icone panneau-info"
            aria-label="Comment lire les messages"
            title="Comment lire les messages"
            aria-expanded={reperes}
            aria-controls="reperes-assistant"
            onClick={() => setReperes((r) => !r)}
          >
            {ICONE_INFO}
          </button>
        </div>
        <div className="rangee ecart-4">
          {echanges.length > 0 && (
            <button
              type="button"
              className="panneau-effacer"
              title="Effacer la conversation"
              aria-label="Effacer la conversation"
              disabled={envoi}
              onClick={() => void effacer().then(() => saisie.current?.focus())}
            >
              {ICONE_CORBEILLE}
              Effacer
            </button>
          )}
          <button
            type="button"
            className="panneau-icone"
            aria-label="Masquer l’assistant"
            title="Masquer l’assistant (Ctrl K)"
            onClick={fermer}
          >
            {ICONE_PANNEAU}
          </button>
        </div>
      </header>

      <section id="reperes-assistant" className="reperes" hidden={!reperes}>
        <h3 className="reperes-titre">Lire les messages</h3>
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

      <ol ref={fil} className="fil-messages panneau-messages" aria-live="polite">
        {echanges.length === 0 && (
          <li className="colonne ecart-8 accueil-assistant">
            <p className="poids-500">Comment puis-je vous aider ?</p>
            <p className="t15 muted">
              L’assistant consulte vos comptes et prépare un brouillon. Il ne soumet jamais rien :
              vous confirmez vous-même, et votre conseiller décide. Vous pouvez aussi faire votre
              demande sans lui.
            </p>
          </li>
        )}
        {echanges.map((echange, i) => (
          <li key={i} className="fil-messages">
            {echange.de === 'client' && (
              <div className="msg-client">
                <p className="msg-entete">
                  <span className="pastille pastille-client" aria-hidden="true">
                    {initiale}
                  </span>
                  Vous
                </p>
                <div className="bulle-msg texte-libre">{echange.texte}</div>
              </div>
            )}
            {echange.de === 'indisponible' && (
              <div className="bandeau-neutre bandeau-indisponible" role="status">
                <div className="indisponible-texte">
                  <span className="point point-neutre marge-haut-8" />
                  <p className="t15 poids-500">{echange.texte}</p>
                </div>
              </div>
            )}
            {echange.de === 'agent' &&
              echange.elements.map((element, j) => <Element key={j} element={element} />)}
          </li>
        ))}
        {envoi && <li className="muted">L’assistant répond…</li>}
      </ol>

      <div className="colonne panneau-saisie">
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
              ref={saisie}
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
    </aside>
  );
}

// Les pictogrammes de l'en-tête du panneau, dessinés au trait, décoratifs.
const ICONE_INFO = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9 8.2v4.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="9" cy="5.6" r="1" fill="currentColor" />
  </svg>
);
const ICONE_CORBEILLE = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
// Le pictogramme « panneau latéral » du bouton qui masque l'assistant.
const ICONE_PANNEAU = (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <rect
      x="2.75"
      y="3.75"
      width="14.5"
      height="12.5"
      rx="2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path d="M12.5 4v12" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

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
          <p className="msg-entete">
            <span className="pastille pastille-ia" aria-hidden="true" />
            Réponse de l’assistant, à vérifier
          </p>
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
          {d.dureeJours === null ? 'durée non renseignée' : enJours(d.dureeJours)}
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
  const { donneesModifiees } = useAssistant();
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
      donneesModifiees();
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
          : erreursDe(e),
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
            <GrandMontant montant={carte.plafondDemande} corps={48} />
          </div>
          <dl className="coffre-encart faits faits-ligne carte-faits">
            <div>
              <dt>Durée</dt>
              <dd>{enJours(carte.dureeJours)}</dd>
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
