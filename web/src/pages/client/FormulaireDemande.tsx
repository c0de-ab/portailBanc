import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ErreurApi, type AvecAvertissements } from '../../api';
import {
  enDirhams,
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
      <p className="discret">Chargement…</p>
    );
  }

  const plafond = entier(champs.plafond) ?? null;
  const justificatifUtile = (plafond ?? 0) > SEUIL_JUSTIFICATIF || demande.justificatifPresent;
  const complement = demande.statut === 'COMPLEMENT_DEMANDE';
  const pret =
    avertissements.length === 0 && demande.plafondDemande !== null && demande.dureeJours !== null;

  if (confirmation) {
    return (
      <>
        <h1>Vérifiez votre demande</h1>
        <p className="chapeau">
          Votre demande sera transmise telle qu’elle apparaît ici. Vous pourrez encore l’annuler
          tant qu’aucune décision n’est prise.
        </p>
        <dl className="recapitulatif">
          <dt>Plafond demandé</dt>
          <dd className="chiffres">{enDirhams(demande.plafondDemande!)}</dd>
          <dt>Durée</dt>
          <dd>
            {demande.dureeJours} jour{demande.dureeJours! > 1 ? 's' : ''}
          </dd>
          <dt>Motif</dt>
          <dd className="texte-libre">{demande.motif}</dd>
          <dt>Justificatif</dt>
          <dd>{demande.justificatifNom ?? 'Aucun'}</dd>
        </dl>
        <ListeErreurs erreurs={erreurs} />
        <div className="actions">
          <button
            type="button"
            className="bouton"
            disabled={enregistrement}
            onClick={() => void soumettre()}
          >
            {enregistrement ? 'Envoi…' : 'Confirmer et soumettre'}
          </button>
          <button type="button" className="lien" onClick={() => setConfirmation(false)}>
            Modifier la demande
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <p>
        <Link to="/client">Mes plafonds</Link>
      </p>
      <h1>
        {complement
          ? `Compléter la demande ${demande.reference}`
          : 'Demande d’augmentation temporaire'}
      </h1>
      {info && (
        <p className="message message-info" role="status">
          {info}
        </p>
      )}

      <form className="formulaire" onSubmit={(e) => e.preventDefault()}>
        <label>
          Plafond souhaité, en dirhams
          <input
            inputMode="numeric"
            value={champs.plafond}
            onChange={(e) => setChamps((c) => ({ ...c, plafond: e.target.value }))}
            onBlur={enregistrerPlafond}
            aria-describedby="jauge-explication"
          />
        </label>
        {plafondInitial !== null && <Jauge plafondInitial={plafondInitial} plafond={plafond} />}

        <label>
          Durée
          <select value={champs.duree} onChange={(e) => enregistrerDuree(e.target.value)}>
            <option value="">Choisir une durée</option>
            {[1, 2, 3, 4, 5, 6, 7].map((j) => (
              <option key={j} value={j}>
                {j} jour{j > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          Motif
          <textarea
            rows={4}
            maxLength={2000}
            value={champs.motif}
            onChange={(e) => setChamps((c) => ({ ...c, motif: e.target.value }))}
            onBlur={enregistrerMotif}
          />
        </label>

        {justificatifUtile && (
          <label>
            Justificatif (PDF, JPEG ou PNG, 2 Mo au plus)
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => deposer(e.target.files?.[0])}
            />
            {demande.justificatifNom && (
              <span className="discret">Fichier enregistré : {demande.justificatifNom}</span>
            )}
          </label>
        )}
      </form>

      <p className="discret" role="status">
        {enregistrement
          ? 'Enregistrement…'
          : 'Chaque modification est enregistrée automatiquement, sans être soumise.'}
      </p>

      <ListeErreurs erreurs={erreurs} />
      <Avertissements avertissements={avertissements} />

      <div className="actions">
        <button
          type="button"
          className="bouton"
          disabled={!pret || enregistrement}
          onClick={() => {
            setInfo(null);
            setConfirmation(true);
          }}
        >
          Vérifier et confirmer
        </button>
        {demande.statut === 'BROUILLON' && (
          <button type="button" className="lien lien-danger" onClick={() => void abandonner()}>
            Abandonner le brouillon
          </button>
        )}
      </div>
    </>
  );
}

// La jauge situe le montant parmi les seuils des règles. Elle est décorative : la phrase qui
// la suit dit la même chose en texte, pour les lecteurs d'écran.
function Jauge({ plafondInitial, plafond }: { plafondInitial: number; plafond: number | null }) {
  const position = (montant: number) =>
    `${Math.min(100, Math.max(0, (montant / PLAFOND_MAXIMUM) * 100))}%`;
  const horsBornes = plafond !== null && (plafond <= plafondInitial || plafond > PLAFOND_MAXIMUM);
  return (
    <div className="jauge">
      <div className="jauge-piste" aria-hidden="true">
        {plafond !== null && (
          <div
            className={`jauge-remplissage${horsBornes ? ' hors-bornes' : ''}`}
            style={{ width: position(plafond) }}
          />
        )}
        <span className="jauge-repere repere-initial" style={{ left: position(plafondInitial) }} />
        <span className="jauge-repere" style={{ left: position(SEUIL_DECISION_CONSEILLER) }} />
        <span className="jauge-repere" style={{ left: position(SEUIL_JUSTIFICATIF) }} />
      </div>
      <div className="jauge-graduations" aria-hidden="true">
        <span style={{ left: position(plafondInitial) }}>{enDirhams(plafondInitial)}</span>
        <span style={{ left: position(SEUIL_DECISION_CONSEILLER) }}>30 000</span>
        <span style={{ left: position(SEUIL_JUSTIFICATIF) }}>50 000</span>
        <span style={{ left: '100%' }}>100 000</span>
      </div>
      <p id="jauge-explication" className="discret">
        Votre plafond habituel est de {enDirhams(plafondInitial)}. Vous pouvez demander jusqu’à{' '}
        {enDirhams(PLAFOND_MAXIMUM)}. Au-delà de {enDirhams(SEUIL_DECISION_CONSEILLER)}, la demande
        passe par une validation supplémentaire ; au-delà de {enDirhams(SEUIL_JUSTIFICATIF)}, un
        justificatif est obligatoire.
      </p>
    </div>
  );
}

// Les avertissements viennent du serveur (verifierRegles) : ce sont des données du système.
function Avertissements({ avertissements }: { avertissements: ErreurDetaillee[] }) {
  return (
    <div aria-live="polite">
      {avertissements.length > 0 && (
        <div className="message message-avertissement">
          <p>
            <strong>Avant de soumettre :</strong>
          </p>
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

export function ListeErreurs({ erreurs }: { erreurs: ErreurDetaillee[] }) {
  if (erreurs.length === 0) {
    return null;
  }
  return (
    <div className="message message-erreur" role="alert">
      <ul>
        {erreurs.map((e, i) => (
          <li key={i}>{e.message}</li>
        ))}
      </ul>
    </div>
  );
}
