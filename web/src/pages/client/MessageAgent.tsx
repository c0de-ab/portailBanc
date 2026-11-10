import { Link } from 'react-router';
import {
  enDirhams,
  enJours,
  libelleClient,
  type Compte,
  type Demande,
  type ElementAgent,
  type ErreurDetaillee,
} from '../../types';
import { Carte } from './CarteConfirmation';
import { COCHE_ENCRE } from './icones';

// Un élément d'une réponse de l'agent, présenté selon sa nature :
// - donnée du système : le résultat d'un outil, lu en base par le serveur ;
// - explication : le texte du modèle, NON FIABLE (il peut être influencé par un message) ;
// - action réalisée : ce que le serveur a effectivement fait ;
// - confirmation : la carte que seul le client peut valider (R7).
// Tout est affiché comme du texte, jamais comme du HTML.
export function MessageAgent({ element }: { element: ElementAgent }) {
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
