import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAssistant } from '../../assistant';
import { useSession } from '../../session';
import { ICONE_CORBEILLE, ICONE_INFO, ICONE_PANNEAU } from './icones';
import { MessageAgent } from './MessageAgent';
import { ReperesAssistant } from './ReperesAssistant';

// Le chat du client avec l'agent, dans un panneau ouvert à côté de la page en cours. La logique
// de la conversation est dans useAssistant (assistant.tsx) ; l'affichage de chaque réponse dans
// MessageAgent, et la carte de confirmation dans CarteConfirmation. Tout est affiché comme du
// texte, jamais comme du HTML. L'agent ne soumet jamais : seule la carte de confirmation, cliquée
// par le client, appelle la route de soumission (R7).

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

      <ReperesAssistant visible={reperes} />

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
              echange.elements.map((element, j) => <MessageAgent key={j} element={element} />)}
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
