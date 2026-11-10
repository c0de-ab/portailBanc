import { COCHE_ENCRE } from './icones';

// L'aide « Lire les messages », dépliée par le bouton « i » à côté du titre du panneau : un
// échantillon de chaque nature de message, avec sa signification.
export function ReperesAssistant({ visible }: { visible: boolean }) {
  return (
    <section id="reperes-assistant" className="reperes" hidden={!visible}>
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
  );
}
