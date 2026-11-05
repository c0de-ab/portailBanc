import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ErreurApi, type AvecAvertissements } from '../../api';
import { Etat, GrandMontant, Jauge, ListeErreurs } from '../../composants';
import {
  enDirhams,
  libelleClient,
  PLAFOND_MAXIMUM,
  SEUIL_DECISION_CONSEILLER,
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
  const file = useRef<Promise<void>>(Promise.resolve());

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
    lireDemande(compteId, id)
      .then(afficher)
      .catch((e: unknown) =>
        setErreurs(
          e instanceof ErreurApi
            ? e.erreurs
            : [{ code: 'INCONNUE', message: 'Impossible de charger la demande.' }],
        ),
      );
  }, [compteId, id, afficher]);

  // Toute écriture passe par ici : l'erreur est affichée, un conflit recharge la demande.
  function executer(action: (d: Demande) => Promise<AvecAvertissements | void>) {
    const tache = file.current.then(async () => {
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
          await charger();
        } else {
          setErreurs(
            e instanceof ErreurApi
              ? e.erreurs
              : [{ code: 'INCONNUE', message: 'Le serveur est injoignable.' }],
          );
        }
      } finally {
        setEnregistrement(false);
      }
    });
    file.current = tache;
    return tache;
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
  const justificatifRequis = (plafond ?? 0) > SEUIL_JUSTIFICATIF;
  const justificatifUtile = justificatifRequis || demande.justificatifPresent;
  const complement = demande.statut === 'COMPLEMENT_DEMANDE';
  const pret =
    avertissements.length === 0 && demande.plafondDemande !== null && demande.dureeJours !== null;
  const libelle = libelleClient(demande);
  // R1, pour la couleur de la jauge seulement : le serveur reste seul juge.
  const horsBornes =
    plafond !== null &&
    plafondInitial !== null &&
    (plafond <= plafondInitial || plafond > PLAFOND_MAXIMUM);
  const duree = (jours: number) => `${jours} jour${jours > 1 ? 's' : ''}`;
  // Qui décidera, d'après le montant (R8) : une explication, le serveur applique la règle.
  const decideur = (montant: number | null) =>
    montant === null
      ? 'Selon le montant'
      : montant <= SEUIL_DECISION_CONSEILLER
        ? 'Votre conseiller, jusqu’à 30 000 DH'
        : 'Un superviseur, au-delà de 30 000 DH';
  const filAriane = (
    <nav className="fil" aria-label="Fil d’Ariane">
      <Link to="/client">Mes plafonds de virement</Link>
      <span aria-hidden="true">/</span>
      <span>{confirmation ? 'Vérifiez votre demande' : 'Demande d’augmentation temporaire'}</span>
    </nav>
  );

  if (confirmation) {
    const montantConfirme = demande.plafondDemande!;
    return (
      <>
        <div className="entete">
          <div className="colonne" style={{ gap: 8 }}>
            {filAriane}
            <h1 className="h1">Vérifiez votre demande</h1>
            <p className="muted">
              Votre demande sera transmise telle qu’elle apparaît ici. Vous pourrez encore l’annuler
              tant qu’aucune décision n’est prise.
            </p>
          </div>
        </div>

        <div className="g12">
          <div className="colonne" style={{ gridColumn: 'span 7' }}>
            <section className="coffre" style={{ padding: 40 }} aria-labelledby="c-titre">
              <div className="colonne" style={{ gap: 12 }}>
                <p id="c-titre" className="coffre-label">
                  Plafond demandé
                </p>
                <GrandMontant montant={montantConfirme} />
                <p style={{ marginTop: 8 }}>
                  <Etat ton={libelle.ton}>{libelle.texte}</Etat>
                </p>
              </div>
              {plafondInitial !== null && (
                <div style={{ marginTop: 24 }}>
                  <Jauge
                    plafondInitial={plafondInitial}
                    applique={plafondInitial}
                    demande={montantConfirme}
                  />
                </div>
              )}
            </section>

            <section
              className="panel"
              style={{ padding: '16px 32px' }}
              aria-label="Détail de la demande"
            >
              <dl className="lignes">
                <div className="ligne">
                  <dt className="ligne-cle">Plafond demandé</dt>
                  <dd className="ligne-val">{enDirhams(montantConfirme)}</dd>
                </div>
                <div className="ligne">
                  <dt className="ligne-cle">Durée</dt>
                  <dd className="ligne-val">{duree(demande.dureeJours!)}</dd>
                </div>
                <div className="ligne">
                  <dt className="ligne-cle">Motif</dt>
                  <dd className="ligne-val texte-libre">{demande.motif}</dd>
                </div>
                <div className="ligne">
                  <dt className="ligne-cle">Justificatif</dt>
                  <dd className="ligne-val">
                    {demande.justificatifNom ??
                      (montantConfirme > SEUIL_JUSTIFICATIF
                        ? 'Aucun'
                        : 'Aucun, facultatif jusqu’à 50 000 DH')}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <aside
            className="panel colonne"
            style={{ gridColumn: 'span 5', padding: 32 }}
            aria-labelledby="ensuite-titre"
          >
            <div className="colonne" style={{ gap: 4 }}>
              <p className="surtitre">Après votre clic</p>
              <h2 id="ensuite-titre" className="h2">
                Ce qui se passera
              </h2>
            </div>
            <ol className="frise-v" aria-label="Étapes à venir">
              <li className="etape">
                <span className="etape-point">1</span>
                <span className="etape-nom">Examen</span>
                <span className="etape-info">Par votre conseiller</span>
              </li>
              <li className="etape">
                <span className="etape-point">2</span>
                <span className="etape-nom">Décision</span>
                <span className="etape-info">{decideur(montantConfirme)}</span>
              </li>
              <li className="etape">
                <span className="etape-point">3</span>
                <span className="etape-nom">Activation</span>
                <span className="etape-info">
                  La banque applique le plafond après une décision favorable
                </span>
              </li>
              <li className="etape">
                <span className="etape-point">4</span>
                <span className="etape-nom">Échéance</span>
                <span className="etape-info">{duree(demande.dureeJours!)} après l’activation</span>
              </li>
            </ol>
            <ListeErreurs erreurs={erreurs} />
            <div className="separateur" />
            <div className="colonne" style={{ gap: 12 }}>
              <button
                type="button"
                className="btn btn-primaire btn-plein"
                disabled={enregistrement}
                onClick={() => void soumettre()}
              >
                {enregistrement ? 'Envoi…' : 'Confirmer et soumettre'}
              </button>
              <button
                type="button"
                className="btn btn-secondaire btn-plein"
                onClick={() => setConfirmation(false)}
              >
                Modifier la demande
              </button>
            </div>
            <p className="muted" style={{ textAlign: 'center', fontWeight: 500 }}>
              Rien n’est soumis sans ce clic.
            </p>
          </aside>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="entete" style={{ alignItems: 'flex-start' }}>
        <div className="colonne" style={{ gap: 8 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <Link className="lien" to="/client/assistant">
            Préparer avec l’assistant
          </Link>
          <Etat ton={libelle.ton}>{libelle.texte}</Etat>
        </div>
      </div>
      {info && (
        <p className="message message-info" role="status" style={{ marginBottom: 24 }}>
          {info}
        </p>
      )}

      <div className="g12">
        <form
          className="panel colonne"
          style={{ gridColumn: 'span 7', padding: 40, gap: 32 }}
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
            <legend className="etiquette" style={{ marginBottom: 8 }}>
              Durée
            </legend>
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
                  <span>{duree(j)}</span>
                </label>
              ))}
            </div>
            <p className="aide" style={{ marginTop: 8 }}>
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
                {justificatifRequis ? (
                  <span className="t13" style={{ color: '#8F5300', fontWeight: 500 }}>
                    Obligatoire
                  </span>
                ) : (
                  <span className="t13 muted">Facultatif</span>
                )}
              </div>
              <div
                className={
                  justificatifRequis && !demande.justificatifPresent
                    ? 'depot'
                    : 'depot depot-neutre'
                }
              >
                <div className="colonne" style={{ gap: 4, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>
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

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 24,
              flexWrap: 'wrap',
            }}
          >
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

        <aside
          className="coffre"
          style={{ gridColumn: 'span 5', padding: 32 }}
          aria-labelledby="recap-titre"
        >
          <div className="colonne" style={{ gap: 24 }}>
            <div className="colonne" style={{ gap: 8 }}>
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

            <div className="coffre-encart lignes" style={{ padding: '0 20px' }}>
              <div className="ligne">
                <span className="ligne-cle">Plafond habituel</span>
                <span className="ligne-val">
                  {plafondInitial === null ? '…' : enDirhams(plafondInitial)}
                </span>
              </div>
              <div className="ligne">
                <span className="ligne-cle">Durée</span>
                <span className="ligne-val">
                  {champs.duree === '' ? 'Non renseignée' : duree(Number(champs.duree))}
                </span>
              </div>
              <div className="ligne">
                <span className="ligne-cle">Décision</span>
                <span className="ligne-val">{decideur(plafond)}</span>
              </div>
              <div className="ligne">
                <span className="ligne-cle">Justificatif</span>
                <span className="ligne-val">
                  {demande.justificatifNom ??
                    (justificatifRequis
                      ? 'Obligatoire, à déposer'
                      : 'Facultatif jusqu’à 50 000 DH')}
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
          <p style={{ fontWeight: 500 }}>Avant de soumettre</p>
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
