import { useEffect, useState } from 'react';
import { api } from '../../api';
import { LIBELLE_MODE_BANQUE, type ModeBanque } from '../../types';

// Le mode de la banque simulée, pour la démonstration (scénario 5). La route n'existe que si
// DEMO_MODE=true : sinon elle répond 404 et le sélecteur n'apparaît pas.
export function ModeBanqueDemo() {
  const [mode, setMode] = useState<ModeBanque | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    api
      .modeBanque()
      .then((r) => setMode(r.mode))
      .catch(() => setMode(null));
  }, []);

  if (!mode) {
    return null;
  }

  async function changer(nouveau: ModeBanque) {
    setErreur(null);
    try {
      setMode((await api.changerModeBanque(nouveau)).mode);
    } catch {
      setErreur('Le mode n’a pas pu être changé.');
    }
  }

  return (
    <fieldset className="mode-banque">
      <legend className="t13 muted" style={{ fontWeight: 500, marginBottom: 8 }}>
        Banque simulée (démonstration)
      </legend>
      <div className="segment">
        {(Object.keys(LIBELLE_MODE_BANQUE) as ModeBanque[]).map((m) => (
          <label key={m} className="segment-opt">
            <input
              type="radio"
              name="mode-banque"
              value={m}
              checked={mode === m}
              onChange={() => void changer(m)}
            />
            <span>{LIBELLE_MODE_BANQUE[m]}</span>
          </label>
        ))}
      </div>
      <p className="aide" style={{ marginTop: 8, maxWidth: 420 }}>
        Ce mode s’applique aux nouvelles opérations ; une opération déjà connue de la banque renvoie
        toujours son résultat enregistré.
      </p>
      {erreur && <p className="message message-erreur">{erreur}</p>}
    </fieldset>
  );
}
