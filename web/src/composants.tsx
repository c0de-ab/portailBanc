import { ErreurApi } from './api';
import {
  dateBreve,
  PLAFOND_MAXIMUM,
  SEUIL_DECISION_CONSEILLER,
  SEUIL_JUSTIFICATIF,
  type Demande,
  type ErreurDetaillee,
  type Ton,
} from './types';

// Les erreurs d'une action, au format de l'API, affichées comme du texte.
export function ListeErreurs({ erreurs }: { erreurs: ErreurDetaillee[] }) {
  if (erreurs.length === 0) {
    return null;
  }
  return (
    <div className="message message-erreur" role="alert">
      <ul>
        {erreurs.map((e, i) => (
          <li key={i}>{e.message}</li>
        ))}
      </ul>
    </div>
  );
}

// Les erreurs à afficher pour une exception : celles de l'API, ou un message générique.
export function erreursDe(e: unknown, message = 'Le serveur est injoignable.'): ErreurDetaillee[] {
  return e instanceof ErreurApi ? e.erreurs : [{ code: 'INCONNUE', message }];
}

// Un état : un point de couleur suivi du texte. La couleur ne porte un sens que pour un plafond
// actif (vert), une action requise (ambre) ou un refus (rouge) ; le reste est neutre.
const POINT: Record<Ton, string> = {
  neutre: 'point-neutre',
  attente: 'point-neutre',
  termine: 'point-neutre',
  action: 'point-action',
  actif: 'point-actif',
  refus: 'point-refus',
};

export function Etat({
  ton,
  children,
  className = '',
}: {
  ton: Ton;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`etat ${className}`}>
      <span className={`point ${POINT[ton]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

// Un montant mis en avant : le chiffre en grand corps léger, l'unité à côté.
export function GrandMontant({
  montant,
  taille = 'l',
  corps,
}: {
  montant: number;
  taille?: 'l' | 'm' | 's';
  // Un corps plus petit pour le grand montant, dans une colonne étroite (en px).
  corps?: number;
}) {
  const classe = taille === 'l' ? 'montant' : `montant-${taille}`;
  const style = corps ? { fontSize: corps, lineHeight: `${corps + 4}px` } : undefined;
  return (
    <p className={classe} style={style}>
      {montant.toLocaleString('fr-FR')}
      <span className="devise">DH</span>
    </p>
  );
}

// La jauge du plafond, sur le coffre : de 0 à 100 000 DH. En plein, ce que la banque applique ;
// en hachuré, ce qui est demandé ou décidé et pas encore appliqué. Repères au plafond habituel
// et aux deux seuils des règles (30 000 DH : superviseur ; 50 000 DH : justificatif).
export function Jauge({
  plafondInitial,
  applique,
  demande = null,
  horsBornes = false,
  legendeLongue = false,
}: {
  plafondInitial: number;
  applique: number;
  demande?: number | null;
  // Le montant demandé enfreint R1 : il passe en rouge. Le serveur reste seul juge.
  horsBornes?: boolean;
  legendeLongue?: boolean;
}) {
  const position = (montant: number) =>
    `${Math.min(100, Math.max(0, (montant / PLAFOND_MAXIMUM) * 100))}%`;
  // Une cible distincte seulement si le montant demandé dépasse ce qui est appliqué.
  const cible = demande !== null && demande > applique;
  const egal = demande !== null && demande === applique;
  const enDh = (montant: number) => `${montant.toLocaleString('fr-FR')} DH`;
  const description =
    demande === null
      ? `Plafond appliqué : ${enDh(applique)}, sur une échelle de 0 à 100 000 DH.`
      : `Plafond demandé : ${enDh(demande)} ; plafond appliqué : ${enDh(applique)} ; échelle de 0 à 100 000 DH.`;
  return (
    <div className="colonne" style={{ gap: 16 }}>
      <div className="jauge" role="img" aria-label={description}>
        <div className="jauge-piste">
          {demande !== null && (
            <div
              className={`jauge-demande${horsBornes ? ' hors-bornes' : ''}`}
              style={{ width: position(demande) }}
            />
          )}
          <div className="jauge-applique" style={{ width: position(applique) }} />
          <span className="jauge-repere" style={{ left: position(plafondInitial) }} />
          <span className="jauge-repere" style={{ left: position(SEUIL_DECISION_CONSEILLER) }} />
          <span className="jauge-repere" style={{ left: position(SEUIL_JUSTIFICATIF) }} />
          <span className="jauge-curseur" style={{ left: position(applique) }}>
            {!cible && <span className="bulle">{egal ? 'Appliqué = demandé' : 'Appliqué'}</span>}
          </span>
          {cible && (
            <span className="jauge-cible" style={{ left: position(demande!) }}>
              <span className="bulle">Demandé</span>
            </span>
          )}
        </div>
        <div className="jauge-graduation" aria-hidden="true" />
        <div className="jauge-echelle" aria-hidden="true">
          <span className="grad grad-debut" style={{ left: '0%' }}>
            <span className="grad-val">0</span>
          </span>
          <span className="grad" style={{ left: position(plafondInitial) }}>
            <span className="grad-val">{plafondInitial.toLocaleString('fr-FR')}</span>
            <span className="grad-leg">{legendeLongue ? 'Plafond habituel' : 'Habituel'}</span>
          </span>
          <span className="grad" style={{ left: position(SEUIL_DECISION_CONSEILLER) }}>
            <span className="grad-val">30 000</span>
            <span className="grad-leg">
              {legendeLongue ? 'Seuil du superviseur' : 'Superviseur'}
            </span>
          </span>
          <span className="grad" style={{ left: position(SEUIL_JUSTIFICATIF) }}>
            <span className="grad-val">50 000</span>
            <span className="grad-leg">
              {legendeLongue ? 'Seuil du justificatif' : 'Justificatif'}
            </span>
          </span>
          <span className="grad grad-fin" style={{ left: '100%' }}>
            <span className="grad-val">100 000 DH</span>
            <span className="grad-leg">Maximum</span>
          </span>
        </div>
      </div>
      {cible && (
        <div className="legende" aria-hidden="true">
          <span>
            <span className="leg-applique" />
            Appliqué par la banque
          </span>
          <span>
            <span className="leg-demande" />
            Demandé
          </span>
        </div>
      )}
    </div>
  );
}

// Le cycle de vie d'une demande, en frise : les étapes passées, l'étape en cours, celles à venir.
// Calculée à partir du statut et des dates que l'API fournit, rien d'autre ; une demande annulée
// ou abandonnée n'a pas de frise.
type EtapeVue = { nom: string; etat: 'fait' | 'encours' | 'refus' | 'avenir'; info?: string };

function etapesDe(d: Demande): EtapeVue[] | null {
  const noms = ['Brouillon', 'Examen', 'Décision', 'Activation', 'Échéance'];
  const index: Partial<Record<Demande['statut'], number>> = {
    BROUILLON: 0,
    SOUMISE: 1,
    COMPLEMENT_DEMANDE: 1,
    ATTENTE_SUPERVISEUR: 1,
    REJETEE: 2,
    APPROUVEE: 3,
    ACTIVE: 3,
    EXPIREE: 5,
  };
  const courant = index[d.statut];
  if (courant === undefined) {
    return null;
  }
  return noms.map((nom, i) => {
    if (i < courant) {
      const info = i === 2 ? 'Favorable' : 'Terminé';
      return {
        nom,
        etat: 'fait',
        info: i === 3 && d.dateActivation ? `Appliqué le ${dateBreve(d.dateActivation)}` : info,
      };
    }
    if (i === courant) {
      if (d.statut === 'REJETEE') {
        return { nom, etat: 'refus', info: 'Défavorable' };
      }
      if (i === 3) {
        const info =
          d.statut === 'ACTIVE' && d.dateActivation
            ? `Appliqué par la banque le ${dateBreve(d.dateActivation)}`
            : d.activationStatut === 'ECHEC' || d.activationStatut === 'INCONNU'
              ? 'Pas encore appliqué par la banque'
              : 'En cours auprès de la banque';
        return { nom, etat: 'encours', info };
      }
      return { nom, etat: 'encours', info: 'En cours' };
    }
    if (d.statut === 'REJETEE') {
      return { nom, etat: 'avenir', info: 'Sans objet' };
    }
    return {
      nom,
      etat: 'avenir',
      info: i === 4 && d.dateEcheance ? dateBreve(d.dateEcheance) : undefined,
    };
  });
}

const COCHE = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path
      d="M2.5 6.2 4.8 8.5 9.5 3.5"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function Frise({
  demande,
  sens = 'horizontal',
}: {
  demande: Demande;
  sens?: 'horizontal' | 'vertical';
}) {
  const etapes = etapesDe(demande);
  if (!etapes) {
    return null;
  }
  return (
    <ol className={sens === 'vertical' ? 'frise-v' : 'frise'} aria-label="Étapes de la demande">
      {etapes.map((e, i) => (
        <li
          key={e.nom}
          className={`etape ${e.etat === 'avenir' ? '' : e.etat}`}
          aria-current={e.etat === 'encours' || e.etat === 'refus' ? 'step' : undefined}
        >
          <span className="etape-point">
            {e.etat === 'fait' ? COCHE : e.etat === 'avenir' ? i + 1 : null}
          </span>
          <span className="etape-nom">{e.nom}</span>
          {e.info && <span className="etape-info">{e.info}</span>}
        </li>
      ))}
    </ol>
  );
}

// L'état d'une demande dans un encart, coloré selon son sens (actif, action requise, refus).
export function EncartEtat({ ton, children }: { ton: Ton; children: React.ReactNode }) {
  return (
    <div className={`encart-etat ton-${ton}`}>
      <Etat ton={ton}>{children}</Etat>
    </div>
  );
}
