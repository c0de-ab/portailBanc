import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { enDirhams, libelleClient, type Compte, type Demande } from '../../types';

// Le plafond appliqué par la banque, la demande en cours de chaque compte, et l'historique.
export function TableauDeBord() {
  const [comptes, setComptes] = useState<Compte[] | null>(null);
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.comptes(), api.demandes()])
      .then(([c, d]) => {
        setComptes(c.comptes);
        setDemandes(d.demandes);
      })
      .catch(() => setErreur('Impossible de charger vos comptes. Réessayez dans un instant.'));
  }, []);

  if (erreur) {
    return <p className="message message-erreur">{erreur}</p>;
  }
  if (!comptes) {
    return <p className="discret">Chargement…</p>;
  }

  const enCours = new Set(comptes.map((c) => c.demandeEnCours?.id));
  const passees = demandes.filter((d) => !enCours.has(d.id));

  return (
    <>
      <h1>Mes plafonds de virement</h1>
      {comptes.map((compte) => (
        <section key={compte.id} className="compte">
          <h2>Compte {compte.numero}</h2>
          <p className="montant-principal">
            {enDirhams(compte.plafondCourant)}
            <span className="discret">
              {compte.plafondTemporaireActif
                ? ` plafond temporaire, au lieu de ${enDirhams(compte.plafondInitial)}`
                : ' plafond habituel'}
            </span>
          </p>
          <DemandeEnCours compte={compte} demandes={demandes} />
        </section>
      ))}

      {passees.length > 0 && (
        <section>
          <h2>Demandes précédentes</h2>
          <ul className="liste-demandes">
            {passees.map((d) => (
              <li key={d.id} className={`etat etat-${libelleClient(d).ton}`}>
                <Link to={`/client/demandes/${d.id}`}>{d.reference ?? 'Brouillon'}</Link>
                <span>{libelleClient(d).texte}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function DemandeEnCours({ compte, demandes }: { compte: Compte; demandes: Demande[] }) {
  const resume = compte.demandeEnCours;
  if (!resume) {
    return (
      <Link className="bouton" to={`/client/comptes/${compte.id}/brouillon`}>
        Demander une augmentation temporaire
      </Link>
    );
  }
  // Le libellé complet a besoin de la demande entière (statut d'activation, échéance).
  const demande = demandes.find((d) => d.id === resume.id);
  const libelle = demande
    ? libelleClient(demande)
    : { texte: resume.statut, ton: 'neutre' as const };
  return (
    <div className={`etat etat-${libelle.ton}`}>
      <p>
        <strong>{libelle.texte}</strong>
        {resume.reference && <span className="discret"> {resume.reference}</span>}
      </p>
      {resume.statut === 'BROUILLON' ? (
        <Link className="bouton" to={`/client/comptes/${compte.id}/brouillon`}>
          Reprendre le brouillon
        </Link>
      ) : resume.statut === 'COMPLEMENT_DEMANDE' ? (
        <Link className="bouton" to={`/client/demandes/${resume.id}/completer`}>
          Compléter la demande
        </Link>
      ) : (
        <Link to={`/client/demandes/${resume.id}`}>Voir le détail</Link>
      )}
    </div>
  );
}
