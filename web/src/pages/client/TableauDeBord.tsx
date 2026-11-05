import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { EncartEtat, Etat, Frise, GrandMontant, Jauge } from '../../composants';
import {
  dateBreve,
  dateLisible,
  enDirhams,
  libelleClient,
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
        <div className="colonne" style={{ gap: 4 }}>
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
            <AideAssistant key={`${compte.id}-aide`} sansDemande={!demande} />,
          ];
        })}

        {passees.length > 0 && (
          <section
            style={{ gridColumn: 'span 12', marginTop: 32 }}
            aria-labelledby="precedentes-titre"
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 16 }}>
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

const dureeTexte = (jours: number | null) =>
  jours === null ? '' : `${jours} jour${jours > 1 ? 's' : ''}`;

// Le coffre : le plafond réellement appliqué par la banque. Une demande en cours, pas encore
// appliquée, apparaît sur la jauge comme « Demandé » : la décision favorable n'est pas un
// plafond actif.
function Coffre({ compte, demande }: { compte: Compte; demande: Demande | null }) {
  const demandeEnAttente =
    demande && demande.statut !== 'ACTIVE' && demande.statut !== 'BROUILLON'
      ? demande.plafondDemande
      : null;
  return (
    <section
      className="coffre"
      style={{ gridColumn: 'span 12', padding: '48px 56px 40px' }}
      aria-labelledby={`plafond-${compte.id}`}
    >
      <div className="coffre-haut">
        <div className="colonne" style={{ gap: 12 }}>
          <p id={`plafond-${compte.id}`} className="coffre-label">
            Plafond appliqué
          </p>
          <GrandMontant montant={compte.plafondCourant} />
          <p style={{ marginTop: 8 }}>
            {compte.plafondTemporaireActif ? (
              <Etat ton="actif">Plafond temporaire actif</Etat>
            ) : (
              <Etat ton="neutre">Plafond habituel</Etat>
            )}
          </p>
        </div>
        <dl className="coffre-encart lignes" style={{ padding: '8px 24px', minWidth: 360 }}>
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
      <div style={{ marginTop: 32 }}>
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
    <section
      className="panel"
      style={{ gridColumn: 'span 8', alignSelf: 'stretch', padding: 32 }}
      aria-labelledby={`demande-${demande.id}`}
    >
      <div className="panel-tete">
        <div className="colonne" style={{ gap: 4 }}>
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

      <div style={{ marginTop: 32 }}>
        <Frise demande={demande} />
      </div>

      <div style={{ marginTop: 32 }}>
        <EncartEtat ton={libelle.ton}>{libelle.texte}</EncartEtat>
      </div>
    </section>
  );
}

function SansDemande({ compte }: { compte: Compte }) {
  return (
    <section
      className="panel colonne"
      style={{ gridColumn: 'span 8', alignSelf: 'stretch', padding: 32 }}
      aria-labelledby={`aucune-${compte.id}`}
    >
      <div className="colonne" style={{ gap: 8 }}>
        <p className="surtitre">Demande en cours</p>
        <h2 id={`aucune-${compte.id}`} className="h2">
          Aucune demande en cours
        </h2>
        <p className="muted" style={{ maxWidth: 520 }}>
          Vous pouvez augmenter temporairement votre plafond, de 1 à 7 jours et jusqu’à 100 000 DH.
        </p>
      </div>
      <div className="regles">
        <div className="regle">
          <span className="regle-val">Jusqu’à 30 000 DH</span>
          <span className="t13 muted">Votre conseiller décide.</span>
        </div>
        <div className="regle">
          <span className="regle-val">Au-delà de 30 000 DH</span>
          <span className="t13 muted">Votre conseiller recommande, un superviseur décide.</span>
        </div>
        <div className="regle">
          <span className="regle-val">Au-delà de 50 000 DH</span>
          <span className="t13 muted">
            Justificatif obligatoire : PDF, JPEG ou PNG, 2 Mo maximum.
          </span>
        </div>
        <div className="regle">
          <span className="regle-val">Après la décision</span>
          <span className="t13 muted">Le plafond est actif une fois appliqué par la banque.</span>
        </div>
      </div>
      <Link
        className="btn btn-primaire"
        to={`/client/comptes/${compte.id}/brouillon`}
        style={{ alignSelf: 'flex-start' }}
      >
        Demander une augmentation temporaire
      </Link>
    </section>
  );
}

// Questions proposées : elles ouvrent l'assistant avec la question déjà saisie, sans l'envoyer.
// Ce sont des questions auxquelles le mode simulé sait répondre.
const QUESTIONS_SANS_DEMANDE = [
  'Quel est mon plafond actuel ?',
  'Je voudrais 25 000 DH pendant 3 jours',
];
const QUESTIONS_AVEC_DEMANDE = ['Où en est ma demande ?', 'Quel est mon plafond actuel ?'];

function AideAssistant({ sansDemande }: { sansDemande: boolean }) {
  const questions = sansDemande ? QUESTIONS_SANS_DEMANDE : QUESTIONS_AVEC_DEMANDE;
  return (
    <aside
      className="panel colonne"
      style={{ gridColumn: 'span 4', alignSelf: 'stretch', padding: 32, gap: 12 }}
      aria-label="Assistant"
    >
      <p className="surtitre">Assistant</p>
      <h2 className="h3">
        {sansDemande
          ? 'Besoin d’aide pour préparer votre demande ?'
          : 'Une question sur votre plafond ?'}
      </h2>
      <p className="muted">
        L’assistant vous aide à préparer une demande. Il ne soumet ni ne décide jamais.
      </p>
      <div className="suggestions" style={{ marginTop: 8 }} aria-label="Questions fréquentes">
        {questions.map((question) => (
          <Link key={question} className="suggestion" to="/client/assistant" state={{ question }}>
            {question}
          </Link>
        ))}
      </div>
      <Link
        className="lien"
        to="/client/assistant"
        style={{ marginTop: 'auto', alignSelf: 'flex-start' }}
      >
        Demander à l’assistant
      </Link>
    </aside>
  );
}
