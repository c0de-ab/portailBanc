import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { ListeErreurs, erreursDe } from '../../composants';
import { useSession } from '../../session';
import {
  dateLisible,
  enDirhams,
  libelleDossier,
  type Dossier,
  type ErreurDetaillee,
  type Role,
} from '../../types';
import { ModeBanqueDemo } from './ModeBanqueDemo';

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
      <p className="discret">Chargement…</p>
    );
  }

  const enAttente = dossiers.filter((d) => aTraiter(d, roles));
  const aReprendre = dossiers.filter(activationAReprendre);
  const autres = dossiers.filter((d) => !enAttente.includes(d) && !aReprendre.includes(d));

  return (
    <>
      <h1>{titre}</h1>
      <ModeBanqueDemo />
      <Groupe
        titre="À traiter"
        vide="Aucun dossier n’attend votre décision."
        dossiers={enAttente}
      />
      {aReprendre.length > 0 && (
        <Groupe titre="Activation à reprendre" vide="" dossiers={aReprendre} />
      )}
      <Groupe titre="Autres dossiers" vide="Aucun autre dossier." dossiers={autres} />
    </>
  );
}

function Groupe({ titre, vide, dossiers }: { titre: string; vide: string; dossiers: Dossier[] }) {
  return (
    <section>
      <h2>
        {titre} <span className="discret">({dossiers.length})</span>
      </h2>
      {dossiers.length === 0 ? (
        <p className="discret">{vide}</p>
      ) : (
        <ul className="liste-dossiers">
          {dossiers.map((d) => {
            const libelle = libelleDossier(d);
            return (
              <li key={d.id} className={`etat etat-${libelle.ton}`}>
                <Link to={`/banque/dossiers/${d.id}`}>{d.reference}</Link>
                <span className="chiffres">
                  {d.plafondDemande === null ? '' : enDirhams(d.plafondDemande)}
                  {d.dureeJours !== null && `, ${d.dureeJours} j`}
                </span>
                <span>{libelle.texte}</span>
                <span className="discret">{d.submittedAt && dateLisible(d.submittedAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
