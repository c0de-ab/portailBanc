import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { EncartEtat, Etat, Frise, GrandMontant, Jauge } from '../../composants';
import {
  dateBreve,
  dateLisible,
  enDirhams,
  enJours,
  libelleClient,
  PLAFOND_MAXIMUM,
  SEUIL_DECISION_CONSEILLER,
  SEUIL_JUSTIFICATIF,
  type Compte,
  type Demande,
} from '../../types';

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
    return <p className="chargement">Chargement…</p>;
  }

  const enCours = new Set(comptes.map((c) => c.demandeEnCours?.id));
  const passees = demandes.filter((d) => !enCours.has(d.id));

  return (
    <>
      <div className="entete">
        <div className="colonne ecart-4">
          {comptes.length === 1 && <p className="surtitre">Compte {comptes[0].numero}</p>}
          <h1 className="h1">Mes plafonds de virement</h1>
        </div>
      </div>

      <div className="g12">
        {comptes.map((compte) => {
          const demande = demandes.find((d) => d.id === compte.demandeEnCours?.id) ?? null;
          return [
            <Coffre key={`${compte.id}-coffre`} compte={compte} demande={demande} />,
            demande ? (
              <DemandeEnCours key={`${compte.id}-demande`} compte={compte} demande={demande} />
            ) : (
              <SansDemande key={`${compte.id}-vide`} compte={compte} />
            ),
          ];
        })}

        {passees.length > 0 && (
          <section className="span-12 marge-haut-32" aria-labelledby="precedentes-titre">
            <div className="titre-file">
              <h2 id="precedentes-titre" className="h2">
                Demandes précédentes
              </h2>
              <span className="muted">
                {passees.length} demande{passees.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="panel tableau-boite">
              <table className="tableau">
                <thead>
                  <tr>
                    <th scope="col">Référence</th>
                    <th scope="col" className="num">
                      Plafond
                    </th>
                    <th scope="col">Durée</th>
                    <th scope="col">État</th>
                    <th scope="col">Créée le</th>
                  </tr>
                </thead>
                <tbody>
                  {passees.map((d) => {
                    const libelle = libelleClient(d);
                    return (
                      <tr key={d.id}>
                        <td>
                          <Link className="ref-lien" to={`/client/demandes/${d.id}`}>
                            {d.reference ?? 'Brouillon'}
                          </Link>
                        </td>
                        <td className="num">
                          {d.plafondDemande === null ? '' : enDirhams(d.plafondDemande)}
                        </td>
                        <td>{dureeTexte(d.dureeJours)}</td>
                        <td>
                          <Etat ton={libelle.ton}>{libelle.texte}</Etat>
                        </td>
                        <td>{dateBreve(d.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

const dureeTexte = (jours: number | null) => (jours === null ? '' : enJours(jours));

// Le coffre : le plafond réellement appliqué par la banque. Une demande en cours, pas encore
// appliquée, apparaît sur la jauge comme « Demandé » : la décision favorable n'est pas un
// plafond actif.
function Coffre({ compte, demande }: { compte: Compte; demande: Demande | null }) {
  const demandeEnAttente =
    demande && demande.statut !== 'ACTIVE' && demande.statut !== 'BROUILLON'
      ? demande.plafondDemande
      : null;
  return (
    <section className="coffre span-12 coffre-compact" aria-labelledby={`plafond-${compte.id}`}>
      <div className="coffre-haut">
        <div className="colonne ecart-8">
          <p id={`plafond-${compte.id}`} className="coffre-label">
            Plafond appliqué
          </p>
          <GrandMontant montant={compte.plafondCourant} corps={64} />
          <p className="marge-haut-4">
            {compte.plafondTemporaireActif ? (
              <Etat ton="actif">Plafond temporaire actif</Etat>
            ) : (
              <Etat ton="neutre">Plafond habituel</Etat>
            )}
          </p>
        </div>
        <dl className="coffre-encart lignes encart-compte">
          <div className="ligne">
            <dt className="ligne-cle">Plafond habituel</dt>
            <dd className="ligne-val">{enDirhams(compte.plafondInitial)}</dd>
          </div>
          <div className="ligne">
            {demande?.statut === 'ACTIVE' && demande.dateEcheance ? (
              <>
                <dt className="ligne-cle">Date de fin</dt>
                <dd className="ligne-val">{dateLisible(demande.dateEcheance)}</dd>
              </>
            ) : (
              <>
                <dt className="ligne-cle">Plafond temporaire</dt>
                <dd className="ligne-val">{compte.plafondTemporaireActif ? 'Actif' : 'Aucun'}</dd>
              </>
            )}
          </div>
        </dl>
      </div>
      <div className="marge-haut-8">
        <Jauge
          plafondInitial={compte.plafondInitial}
          applique={compte.plafondCourant}
          demande={demandeEnAttente}
          legendeLongue
        />
      </div>
    </section>
  );
}

function DemandeEnCours({ compte, demande }: { compte: Compte; demande: Demande }) {
  const libelle = libelleClient(demande);
  return (
    <section className="panel span-12 interieur-32" aria-labelledby={`demande-${demande.id}`}>
      <div className="panel-tete">
        <div className="colonne ecart-4">
          <p className="surtitre">Demande en cours</p>
          <h2 id={`demande-${demande.id}`} className="h2 ref">
            {demande.reference ?? 'Brouillon'}
          </h2>
          {demande.plafondDemande !== null && (
            <p className="muted">
              {enDirhams(demande.plafondDemande)}
              {demande.dureeJours ? ` pendant ${dureeTexte(demande.dureeJours)}` : ''}
            </p>
          )}
        </div>
        {demande.statut === 'BROUILLON' ? (
          <Link className="btn btn-primaire" to={`/client/comptes/${compte.id}/brouillon`}>
            Reprendre le brouillon
          </Link>
        ) : demande.statut === 'COMPLEMENT_DEMANDE' ? (
          <Link className="btn btn-primaire" to={`/client/demandes/${demande.id}/completer`}>
            Compléter la demande
          </Link>
        ) : (
          <Link className="btn btn-secondaire" to={`/client/demandes/${demande.id}`}>
            Voir le détail
          </Link>
        )}
      </div>

      <div className="marge-haut-32">
        <Frise demande={demande} />
      </div>

      <div className="marge-haut-32">
        <EncartEtat ton={libelle.ton}>{libelle.texte}</EncartEtat>
      </div>
    </section>
  );
}

function SansDemande({ compte }: { compte: Compte }) {
  return (
    <section className="panel colonne span-12 interieur-32" aria-labelledby={`aucune-${compte.id}`}>
      <div className="colonne ecart-8">
        <p className="surtitre">Demande en cours</p>
        <h2 id={`aucune-${compte.id}`} className="h2">
          Aucune demande en cours
        </h2>
        <p className="muted largeur-520">
          Vous pouvez augmenter temporairement votre plafond, de 1 à 7 jours et jusqu’à{' '}
          {enDirhams(PLAFOND_MAXIMUM)}.
        </p>
      </div>
      <div className="regles regles-ligne">
        <div className="regle">
          <span className="regle-val">Jusqu’à {enDirhams(SEUIL_DECISION_CONSEILLER)}</span>
          <span className="t13 muted">Votre conseiller décide.</span>
        </div>
        <div className="regle">
          <span className="regle-val">Au-delà de {enDirhams(SEUIL_DECISION_CONSEILLER)}</span>
          <span className="t13 muted">Votre conseiller recommande, un superviseur décide.</span>
        </div>
        <div className="regle">
          <span className="regle-val">Au-delà de {enDirhams(SEUIL_JUSTIFICATIF)}</span>
          <span className="t13 muted">
            Justificatif obligatoire : PDF, JPEG ou PNG, 2 Mo maximum.
          </span>
        </div>
        <div className="regle">
          <span className="regle-val">Après la décision</span>
          <span className="t13 muted">Le plafond est actif une fois appliqué par la banque.</span>
        </div>
      </div>
      <Link className="btn btn-primaire aligne-debut" to={`/client/comptes/${compte.id}/brouillon`}>
        Demander une augmentation temporaire
      </Link>
    </section>
  );
}
