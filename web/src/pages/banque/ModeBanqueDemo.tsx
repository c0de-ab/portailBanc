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
    <div className="mode-banque">
      <label>
        Banque simulée (démonstration)
        <select value={mode} onChange={(e) => void changer(e.target.value as ModeBanque)}>
          {(Object.keys(LIBELLE_MODE_BANQUE) as ModeBanque[]).map((m) => (
            <option key={m} value={m}>
              {LIBELLE_MODE_BANQUE[m]}
            </option>
          ))}
        </select>
      </label>
      <p className="discret">
        Ce mode s’applique aux nouvelles opérations ; une opération déjà connue de la banque renvoie
        toujours son résultat enregistré.
      </p>
      {erreur && <p className="message message-erreur">{erreur}</p>}
    </div>
  );
}
