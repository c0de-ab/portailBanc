import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ErreurApi, type AvecAvertissements } from '../../api';
import { useAssistant } from '../../assistant';
import { erreursDe, Etat, GrandMontant, Jauge, ListeErreurs } from '../../composants';
import { creerFile } from '../../file';
import { EcranConfirmation, quiDecide } from './EcranConfirmation';
import {
  enDirhams,
  enJours,
  libelleClient,
  PLAFOND_MAXIMUM,
  SEUIL_JUSTIFICATIF,
  type Demande,
  type ErreurDetaillee,
} from '../../types';

// Un brouillon (/client/comptes/:compteId/brouillon) ou une demande en « Complément demandé »
// (/client/demandes/:id/completer). Chaque champ est enregistré quand il perd le focus ; le
// serveur renvoie alors les avertissements de verifierRegles (H23), qui ne bloquent rien.
// La soumission passe par une étape de confirmation explicite (R7).

const MESSAGE_CONFLIT =
  'La demande a changé entre-temps (dans un autre onglet ou avec l’assistant). Elle a été rechargée : vérifiez-la avant de continuer.';

type Champs = { plafond: string; duree: string; motif: string };

const champsDe = (d: Demande): Champs => ({
  plafond: d.plafondDemande === null ? '' : String(d.plafondDemande),
  duree: d.dureeJours === null ? '' : String(d.dureeJours),
  motif: d.motif ?? '',
});

// Le brouillon est obtenu ou créé par la même route (idempotente) ; un complément est relu.
async function lireDemande(compteId: string | undefined, id: string | undefined) {
  const r: AvecAvertissements = compteId
    ? await api.obtenirBrouillon(compteId)
    : { demande: (await api.demande(id!)).demande, avertissements: [] };
  const { comptes } = await api.comptes();
  const plafondInitial = comptes.find((c) => c.id === r.demande.compteId)?.plafondInitial ?? null;
  return { r, plafondInitial };
}

export function FormulaireDemande() {
  const { compteId, id } = useParams();
  const naviguer = useNavigate();
  const { ouvrir } = useAssistant();
  const [demande, setDemande] = useState<Demande | null>(null);
  const [plafondInitial, setPlafondInitial] = useState<number | null>(null);
  const [champs, setChamps] = useState<Champs>({ plafond: '', duree: '', motif: '' });
  const [avertissements, setAvertissements] = useState<ErreurDetaillee[]>([]);
  const [erreurs, setErreurs] = useState<ErreurDetaillee[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [confirmation, setConfirmation] = useState(false);

  // La dernière demande connue, avec sa version : les enregistrements s'enchaînent dans l'ordre,
  // chacun partant de la version renvoyée par le précédent.
  const derniere = useRef<Demande | null>(null);
  const [ajouterALaFile] = useState(creerFile);

  const appliquer = useCallback((r: AvecAvertissements) => {
    derniere.current = r.demande;
    setDemande(r.demande);
    setAvertissements(r.avertissements);
  }, []);

  // La lecture renvoie les données ; leur affichage est fait ensuite, hors de l'effet.
  const afficher = useCallback(
    ({ r, plafondInitial }: Awaited<ReturnType<typeof lireDemande>>) => {
      setPlafondInitial(plafondInitial);
      appliquer(r);
      setChamps(champsDe(r.demande));
    },
    [appliquer],
  );
  const charger = useCallback(
    async () => afficher(await lireDemande(compteId, id)),
    [compteId, id, afficher],
  );

  useEffect(() => {
    // Si l'adresse change avant la réponse (autre dossier), l'ancienne réponse est ignorée.
    let actif = true;
    lireDemande(compteId, id)
      .then((d) => actif && afficher(d))
      .catch(
        (e: unknown) => actif && setErreurs(erreursDe(e, 'Impossible de charger la demande.')),
      );
    return () => {
      actif = false;
    };
  }, [compteId, id, afficher]);

  // Toute écriture passe par ici : l'erreur est affichée, un conflit recharge la demande.
  // La tâche ne lève jamais : un échec, même du rechargement, est affiché, et la file continue.
  function executer(action: (d: Demande) => Promise<AvecAvertissements | void>) {
    return ajouterALaFile(async () => {
      setEnregistrement(true);
      setErreurs([]);
      try {
        const r = await action(derniere.current!);
        if (r) {
          appliquer(r);
        }
      } catch (e) {
        if (e instanceof ErreurApi && e.estUnConflit) {
          setConfirmation(false);
          setInfo(MESSAGE_CONFLIT);
          await charger().catch((rechargement: unknown) => setErreurs(erreursDe(rechargement)));
        } else {
          setErreurs(erreursDe(e));
        }
      } finally {
        setEnregistrement(false);
      }
    });
  }

  // Un nombre entier, ou null si le champ est vide ; undefined si la saisie n'est pas un entier.
  function entier(texte: string): number | null | undefined {
    if (texte.trim() === '') {
      return null;
    }
    const n = Number(texte.replace(/\s/g, ''));
    return Number.isInteger(n) ? n : undefined;
  }

  function enregistrerPlafond() {
    const valeur = entier(champs.plafond);
    if (valeur === undefined) {
      setErreurs([
        { code: 'R1', champ: 'plafondDemande', message: 'Saisissez un montant entier en dirhams.' },
      ]);
      return;
    }
    if (valeur !== derniere.current?.plafondDemande) {
      void executer((d) => api.modifier(d, { plafondDemande: valeur }));
    }
  }

  function enregistrerDuree(texte: string) {
    setChamps((c) => ({ ...c, duree: texte }));
    void executer((d) => api.modifier(d, { dureeJours: entier(texte) ?? null }));
  }

  function enregistrerMotif() {
    const valeur = champs.motif === '' ? null : champs.motif;
    if (valeur !== derniere.current?.motif) {
      void executer((d) => api.modifier(d, { motif: valeur }));
    }
  }

  function deposer(fichier: File | undefined) {
    if (fichier) {
      void executer((d) => api.deposerJustificatif(d, fichier));
    }
  }

  async function soumettre() {
    // Ce que le client a vu sur l'écran de confirmation, avec la version lue (R7).
    const vue = derniere.current!;
    await executer(async (d) => {
      await api.soumettre({
        id: d.id,
        version: vue.version,
        plafondDemande: vue.plafondDemande!,
        dureeJours: vue.dureeJours!,
      });
      naviguer(`/client/demandes/${d.id}`, { replace: true });
    });
  }

  async function abandonner() {
    if (window.confirm('Abandonner ce brouillon ? Il restera visible dans votre historique.')) {
      await executer(async (d) => {
        await api.abandonner(d);
        naviguer('/client', { replace: true });
      });
    }
  }

  if (!demande) {
    return erreurs.length > 0 ? (
      <ListeErreurs erreurs={erreurs} />
    ) : (
      <p className="chargement">Chargement…</p>
    );
  }

  const plafond = entier(champs.plafond) ?? null;
  // Les règles viennent du serveur : les avertissements de verifierRegles (H23), renvoyés après
  // chaque enregistrement. L'écran n'en recalcule aucune ; il les montre.
  const regleNonRespectee = (code: string) => avertissements.some((a) => a.code === code);
  // R4 : au-delà du seuil, et aucun fichier encore déposé.
  const justificatifManquant = regleNonRespectee('R4');
  const justificatifUtile = justificatifManquant || demande.justificatifPresent;
  const complement = demande.statut === 'COMPLEMENT_DEMANDE';
  const pret =
    avertissements.length === 0 && demande.plafondDemande !== null && demande.dureeJours !== null;
  const libelle = libelleClient(demande);
  // R1 : le plafond enregistré sort des bornes ; la jauge le signale en couleur, seulement si
  // le montant affiché est bien celui que le serveur a vérifié (pas une saisie en cours).
  const horsBornes = regleNonRespectee('R1') && plafond === demande.plafondDemande;
  const filAriane = (
    <nav className="fil" aria-label="Fil d’Ariane">
      <Link to="/client">Mes plafonds de virement</Link>
      <span aria-hidden="true">/</span>
      <span>{confirmation ? 'Vérifiez votre demande' : 'Demande d’augmentation temporaire'}</span>
    </nav>
  );

  if (confirmation) {
    return (
      <EcranConfirmation
        demande={demande}
        plafondInitial={plafondInitial}
        filAriane={filAriane}
        erreurs={erreurs}
        envoi={enregistrement}
        confirmer={() => void soumettre()}
        modifier={() => setConfirmation(false)}
      />
    );
  }

  return (
    <>
      <div className="entete enfants-haut">
        <div className="colonne ecart-8">
          {filAriane}
          <h1 className="h1">
            {complement
              ? `Compléter la demande ${demande.reference}`
              : 'Demande d’augmentation temporaire'}
          </h1>
          <p className="muted" role="status">
            {enregistrement
              ? 'Enregistrement…'
              : 'Chaque modification est enregistrée automatiquement, sans être soumise.'}
          </p>
        </div>
        <div className="rangee">
          <button type="button" className="lien lien-bouton" onClick={() => ouvrir()}>
            Préparer avec l’assistant
          </button>
          <Etat ton={libelle.ton}>{libelle.texte}</Etat>
        </div>
      </div>
      {info && (
        <p className="message message-info marge-bas-24" role="status">
          {info}
        </p>
      )}

      <div className="g12">
        <form
          className="panel colonne span-7 interieur-40 ecart-32"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="champ">
            <label className="etiquette" htmlFor="f-montant">
              Plafond souhaité
            </label>
            <div className="saisie-montant">
              <input
                id="f-montant"
                className="saisie"
                inputMode="numeric"
                autoComplete="off"
                aria-describedby="f-montant-aide"
                value={champs.plafond}
                onChange={(e) => setChamps((c) => ({ ...c, plafond: e.target.value }))}
                onBlur={enregistrerPlafond}
              />
              <span className="suffixe" aria-hidden="true">
                DH
              </span>
            </div>
            <p id="f-montant-aide" className="aide">
              {plafondInitial !== null && `Plafond habituel : ${enDirhams(plafondInitial)}. `}
              Maximum demandable : {enDirhams(PLAFOND_MAXIMUM)}.
            </p>
          </div>

          <fieldset className="champ">
            <legend className="etiquette marge-bas-8">Durée</legend>
            <div className="choix">
              {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                <label key={j} className="choix-opt">
                  <input
                    type="radio"
                    name="duree"
                    value={j}
                    checked={champs.duree === String(j)}
                    onChange={(e) => enregistrerDuree(e.target.value)}
                  />
                  <span>{enJours(j)}</span>
                </label>
              ))}
            </div>
            <p className="aide marge-haut-8">
              De 1 à 7 jours. Le plafond revient ensuite au plafond habituel.
            </p>
          </fieldset>

          <div className="champ">
            <label className="etiquette" htmlFor="f-motif">
              Motif
            </label>
            <textarea
              id="f-motif"
              className="saisie"
              rows={3}
              maxLength={2000}
              value={champs.motif}
              onChange={(e) => setChamps((c) => ({ ...c, motif: e.target.value }))}
              onBlur={enregistrerMotif}
            />
          </div>

          {justificatifUtile && (
            <div className="champ">
              <div className="etiquette-ligne">
                <label className="etiquette" htmlFor="f-justif">
                  Justificatif
                </label>
                {justificatifManquant ? (
                  <span className="t13 texte-obligatoire">Obligatoire</span>
                ) : (
                  <span className="t13 muted">Enregistré</span>
                )}
              </div>
              <div className={justificatifManquant ? 'depot' : 'depot depot-neutre'}>
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
          )}

          <ListeErreurs erreurs={erreurs} />
          <Avertissements avertissements={avertissements} />

          <div className="separateur" />

          <div className="barre-actions">
            <button
              type="button"
              className="btn btn-primaire"
              disabled={!pret || enregistrement}
              onClick={() => {
                setInfo(null);
                setConfirmation(true);
              }}
            >
              Vérifier et confirmer
            </button>
            {demande.statut === 'BROUILLON' && (
              <button
                type="button"
                className="lien lien-bouton lien-refus"
                onClick={() => void abandonner()}
              >
                Abandonner le brouillon
              </button>
            )}
          </div>
        </form>

        <aside className="coffre span-5 interieur-32" aria-labelledby="recap-titre">
          <div className="colonne ecart-24">
            <div className="colonne ecart-8">
              <h2 id="recap-titre" className="coffre-label">
                Récapitulatif
              </h2>
              <p className="t13 muted">Plafond demandé</p>
              {plafond === null ? (
                <p className="montant-s muted">Non renseigné</p>
              ) : (
                <GrandMontant montant={plafond} corps={64} />
              )}
            </div>

            {plafondInitial !== null && (
              <Jauge
                plafondInitial={plafondInitial}
                applique={plafondInitial}
                demande={plafond}
                horsBornes={horsBornes}
              />
            )}

            <div className="coffre-encart lignes encart-lignes">
              <div className="ligne">
                <span className="ligne-cle">Plafond habituel</span>
                <span className="ligne-val">
                  {plafondInitial === null ? '…' : enDirhams(plafondInitial)}
                </span>
              </div>
              <div className="ligne">
                <span className="ligne-cle">Durée</span>
                <span className="ligne-val">
                  {champs.duree === '' ? 'Non renseignée' : enJours(Number(champs.duree))}
                </span>
              </div>
              <div className="ligne">
                <span className="ligne-cle">Décision</span>
                <span className="ligne-val">{quiDecide(plafond)}</span>
              </div>
              <div className="ligne">
                <span className="ligne-cle">Justificatif</span>
                <span className="ligne-val">
                  {demande.justificatifNom ??
                    (justificatifManquant
                      ? 'Obligatoire, à déposer'
                      : `Facultatif jusqu’à ${enDirhams(SEUIL_JUSTIFICATIF)}`)}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

// Les avertissements viennent du serveur (verifierRegles) : ce sont des données du système.
function Avertissements({ avertissements }: { avertissements: ErreurDetaillee[] }) {
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
