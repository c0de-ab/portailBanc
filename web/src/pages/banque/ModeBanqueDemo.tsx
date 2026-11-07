import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api';
import { LIBELLE_MODE_BANQUE, type ModeBanque } from '../../types';

// Le mode de la banque simulée, pour la démonstration (scénario 5). La route n'existe que si
// DEMO_MODE=true : sinon elle répond 404, et rien n'apparaît.
// Le mode est GLOBAL : il s'applique à toutes les opérations de l'application, pour tous les
// utilisateurs. Deux présentations : un indicateur dans la barre du haut de l'espace banque,
// visible sur toutes ses pages, et le sélecteur complet dans le panneau « Activation ».

// Un changement fait dans l'une des deux présentations met l'autre à jour.
const EVENEMENT_MODE = 'portail:mode-banque';

function useModeBanque() {
  const [mode, setMode] = useState<ModeBanque | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    api
      .modeBanque()
      .then((r) => setMode(r.mode))
      .catch(() => setMode(null));
    const suivre = (e: Event) => setMode((e as CustomEvent<ModeBanque>).detail);
    window.addEventListener(EVENEMENT_MODE, suivre);
    return () => window.removeEventListener(EVENEMENT_MODE, suivre);
  }, []);

  async function changer(nouveau: ModeBanque) {
    setErreur(null);
    try {
      const { mode: applique } = await api.changerModeBanque(nouveau);
      window.dispatchEvent(new CustomEvent(EVENEMENT_MODE, { detail: applique }));
    } catch {
      setErreur('Le mode n’a pas pu être changé.');
    }
  }

  return { mode, erreur, changer };
}

// Les trois modes, en boutons radio. Chaque sélecteur a son propre nom de groupe : deux
// sélecteurs sur la même page ne se mélangent pas.
function Selecteur({
  mode,
  changer,
}: {
  mode: ModeBanque;
  changer: (nouveau: ModeBanque) => Promise<void>;
}) {
  const groupe = useId();
  return (
    <div className="segment">
      {(Object.keys(LIBELLE_MODE_BANQUE) as ModeBanque[]).map((m) => (
        <label key={m} className="segment-opt">
          <input
            type="radio"
            name={groupe}
            value={m}
            checked={mode === m}
            onChange={() => void changer(m)}
          />
          <span>{LIBELLE_MODE_BANQUE[m]}</span>
        </label>
      ))}
    </div>
  );
}

const AIDE_MODE =
  'Ce mode s’applique aux nouvelles opérations ; une opération déjà connue de la banque renvoie toujours son résultat enregistré.';

// Le sélecteur complet, dans le panneau « Activation » d'un dossier : là où il sert, pour
// montrer un échec puis une reprise.
export function ModeBanqueDemo() {
  const { mode, erreur, changer } = useModeBanque();
  if (!mode) {
    return null;
  }
  return (
    <fieldset className="mode-banque">
      <legend className="t13 muted poids-500 marge-bas-8">Banque simulée (démonstration)</legend>
      <Selecteur mode={mode} changer={changer} />
      <p className="aide marge-haut-8 largeur-420">
        S’applique à toute l’application, pour tous les utilisateurs. {AIDE_MODE}
      </p>
      {erreur && <p className="message message-erreur">{erreur}</p>}
    </fieldset>
  );
}

// L'indicateur de la barre du haut : le mode actif, toujours visible dans l'espace banque, en
// ambre dès qu'il n'est plus « Normal ». Un clic ouvre le choix du mode.
export function IndicateurBanqueDemo() {
  const { mode, erreur, changer } = useModeBanque();
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);

  // Un clic en dehors, ou la touche Échap, referme le choix.
  useEffect(() => {
    if (!ouvert) {
      return;
    }
    const clic = (e: MouseEvent) => {
      if (!zone.current?.contains(e.target as Node)) {
        setOuvert(false);
      }
    };
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOuvert(false);
      }
    };
    document.addEventListener('mousedown', clic);
    window.addEventListener('keydown', touche);
    return () => {
      document.removeEventListener('mousedown', clic);
      window.removeEventListener('keydown', touche);
    };
  }, [ouvert]);

  if (!mode) {
    return null;
  }
  const anormal = mode !== 'SUCCES';
  return (
    <div className="indicateur-banque" ref={zone}>
      <button
        type="button"
        className={anormal ? 'indicateur-bouton indicateur-alerte' : 'indicateur-bouton'}
        aria-expanded={ouvert}
        aria-controls="choix-mode-banque"
        onClick={() => setOuvert((o) => !o)}
      >
        <span className={anormal ? 'point point-action' : 'point point-neutre'} />
        Banque simulée : {LIBELLE_MODE_BANQUE[mode]}
      </button>
      {ouvert && (
        <div id="choix-mode-banque" className="indicateur-choix" role="group">
          <p className="poids-500">Banque simulée (démonstration)</p>
          <p className="aide">
            S’applique à toute l’application, pour tous les utilisateurs. {AIDE_MODE}
          </p>
          <Selecteur mode={mode} changer={changer} />
          {erreur && <p className="message message-erreur">{erreur}</p>}
        </div>
      )}
    </div>
  );
}
