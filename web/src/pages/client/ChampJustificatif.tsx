import type { Demande, ErreurDetaillee } from '../../types';

// Le dépôt du justificatif, affiché seulement quand il est utile (au-delà du seuil, ou déjà
// déposé). « Obligatoire » vient de l'avertissement R4 renvoyé par le serveur.
export function ChampJustificatif({
  demande,
  manquant,
  deposer,
}: {
  demande: Demande;
  manquant: boolean;
  deposer: (fichier: File | undefined) => void;
}) {
  return (
    <div className="champ">
      <div className="etiquette-ligne">
        <label className="etiquette" htmlFor="f-justif">
          Justificatif
        </label>
        {manquant ? (
          <span className="t13 texte-obligatoire">Obligatoire</span>
        ) : (
          <span className="t13 muted">Enregistré</span>
        )}
      </div>
      <div className={manquant ? 'depot' : 'depot depot-neutre'}>
        <div className="colonne ecart-4 min-0">
          <span className="poids-500">
            {demande.justificatifNom
              ? `Fichier enregistré : ${demande.justificatifNom}`
              : 'Aucun fichier déposé'}
          </span>
          <span className="aide">PDF, JPEG ou PNG, 2 Mo maximum.</span>
        </div>
        <input
          id="f-justif"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => deposer(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

// Les avertissements viennent du serveur (verifierRegles) : ce sont des données du système.
export function Avertissements({ avertissements }: { avertissements: ErreurDetaillee[] }) {
  return (
    <div aria-live="polite">
      {avertissements.length > 0 && (
        <div className="message message-avertissement">
          <p className="poids-500">Avant de soumettre</p>
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
