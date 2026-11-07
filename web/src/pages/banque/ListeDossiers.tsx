import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { Etat, ListeErreurs, erreursDe } from '../../composants';
import { useSession } from '../../session';
import {
  dateBreve,
  enDirhams,
  enJours,
  libelleDossier,
  libelleRole,
  type Dossier,
  type ErreurDetaillee,
  type Role,
  type Ton,
} from '../../types';

// Ce qui attend une décision de cet utilisateur. Un utilisateur à double rôle voit les deux
// files (H18). Le serveur ne renvoie que les dossiers de son périmètre (R14).
export function aTraiter(d: Dossier, roles: Role[]): boolean {
  return (
    (d.statut === 'SOUMISE' && roles.includes('CONSEILLER')) ||
    (d.statut === 'ATTENTE_SUPERVISEUR' && roles.includes('SUPERVISEUR'))
  );
}

export const activationAReprendre = (d: Dossier) =>
  d.statut === 'APPROUVEE' && (d.activationStatut === 'ECHEC' || d.activationStatut === 'INCONNU');

export function ListeDossiers() {
  const { utilisateur } = useSession();
  const [dossiers, setDossiers] = useState<Dossier[] | null>(null);
  const [erreurs, setErreurs] = useState<ErreurDetaillee[]>([]);

  useEffect(() => {
    api
      .dossiers()
      .then((r) => setDossiers(r.dossiers))
      .catch((e: unknown) => setErreurs(erreursDe(e, 'Impossible de charger les dossiers.')));
  }, []);

  const roles = utilisateur?.roles ?? [];
  const titre = roles.includes('SUPERVISEUR')
    ? roles.includes('CONSEILLER')
      ? 'Dossiers à traiter, conseiller et superviseur'
      : 'Dossiers de l’équipe'
    : 'Mon portefeuille';

  if (!dossiers) {
    return erreurs.length > 0 ? (
      <ListeErreurs erreurs={erreurs} />
    ) : (
      <p className="chargement">Chargement…</p>
    );
  }

  const enAttente = dossiers.filter((d) => aTraiter(d, roles));
  const aReprendre = dossiers.filter(activationAReprendre);
  const autres = dossiers.filter((d) => !enAttente.includes(d) && !aReprendre.includes(d));

  return (
    <>
      <div className="entete enfants-haut">
        <div className="colonne ecart-4">
          <p className="surtitre">{libelleRole(roles)}</p>
          <h1 className="h1">{titre}</h1>
        </div>
      </div>

      {/* La synthèse des trois files ; chaque tuile mène à son tableau. */}
      <div className="g12 marge-bas-56">
        <Tuile
          cible="g-traiter"
          ton="action"
          titre="À traiter"
          detail="Examen ou recommandation"
          nombre={enAttente.length}
        />
        <Tuile
          cible="g-activation"
          ton="action"
          titre="Activation à reprendre"
          detail="La banque n’a pas appliqué le plafond"
          nombre={aReprendre.length}
        />
        <Tuile
          cible="g-autres"
          ton="neutre"
          titre="Autres dossiers"
          detail="Aucune action de votre part"
          nombre={autres.length}
        />
      </div>

      <div className="colonne ecart-56">
        <Groupe
          id="g-traiter"
          titre="À traiter"
          vide="Aucun dossier n’attend votre décision."
          dossiers={enAttente}
        />
        <Groupe
          id="g-activation"
          titre="Activation à reprendre"
          vide="Aucune activation à reprendre."
          dossiers={aReprendre}
        />
        <Groupe
          id="g-autres"
          titre="Autres dossiers"
          vide="Aucun autre dossier."
          dossiers={autres}
        />
      </div>
    </>
  );
}

function Groupe({
  id,
  titre,
  vide,
  dossiers,
}: {
  id: string;
  titre: string;
  vide: string;
  dossiers: Dossier[];
}) {
  // Une file vide tient sur une ligne : son titre et le message, sans panneau.
  if (dossiers.length === 0) {
    return (
      <section id={id} aria-labelledby={id + '-titre'}>
        <div className="file-vide">
          <h2 id={id + '-titre'} className="h2">
            {titre}
          </h2>
          <span className="muted">{vide}</span>
        </div>
      </section>
    );
  }
  return (
    <section id={id} aria-labelledby={id + '-titre'}>
      <div className="titre-file">
        <h2 id={id + '-titre'} className="h2">
          {titre}
        </h2>
        <span className="muted">
          {dossiers.length} dossier{dossiers.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="panel tableau-boite">
        <table className="tableau tableau-dossiers">
          <colgroup>
            <col className="col-reference" />
            <col className="col-plafond" />
            <col className="col-duree" />
            <col className="col-etat" />
            <col className="col-date" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Référence</th>
              <th scope="col" className="num">
                Plafond
              </th>
              <th scope="col">Durée</th>
              <th scope="col">État</th>
              <th scope="col">Soumise le</th>
            </tr>
          </thead>
          <tbody>
            {dossiers.map((d) => {
              const libelle = libelleDossier(d);
              return (
                <tr key={d.id}>
                  <td>
                    <Link className="ref-lien" to={`/banque/dossiers/${d.id}`}>
                      {d.reference}
                    </Link>
                  </td>
                  <td className="num">
                    {d.plafondDemande === null ? '' : enDirhams(d.plafondDemande)}
                  </td>
                  <td>{d.dureeJours === null ? '' : enJours(d.dureeJours)}</td>
                  <td>
                    <Etat ton={libelle.ton}>{libelle.texte}</Etat>
                  </td>
                  <td>{d.submittedAt && dateBreve(d.submittedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tuile({
  cible,
  ton,
  titre,
  detail,
  nombre,
}: {
  cible: string;
  ton: Ton;
  titre: string;
  detail: string;
  nombre: number;
}) {
  return (
    <a className="panel tuile span-4" href={'#' + cible}>
      <span className="colonne ecart-8">
        <Etat ton={ton}>{titre}</Etat>
        <span className="t13 muted">{detail}</span>
      </span>
      <span className="chiffre">{nombre}</span>
    </a>
  );
}
