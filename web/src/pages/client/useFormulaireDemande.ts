import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ErreurApi, type AvecAvertissements } from '../../api';
import { erreursDe } from '../../composants';
import { creerFile } from '../../file';
import type { Demande, ErreurDetaillee } from '../../types';

// La logique du formulaire de demande, sans rien afficher : chargement, enregistrement de chaque
// champ, gestion des conflits, soumission et abandon. Chaque champ est enregistré quand il perd
// le focus ; le serveur renvoie alors les avertissements de verifierRegles (H23), qui ne
// bloquent rien. La soumission passe par une étape de confirmation explicite (R7).

const MESSAGE_CONFLIT =
  'La demande a changé entre-temps (dans un autre onglet ou avec l’assistant). Elle a été rechargée : vérifiez-la avant de continuer.';

export type Champs = { plafond: string; duree: string; motif: string };

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

// Un nombre entier, ou null si le champ est vide ; undefined si la saisie n'est pas un entier.
export function entier(texte: string): number | null | undefined {
  if (texte.trim() === '') {
    return null;
  }
  const n = Number(texte.replace(/\s/g, ''));
  return Number.isInteger(n) ? n : undefined;
}

export function useFormulaireDemande(compteId: string | undefined, id: string | undefined) {
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

  return {
    demande,
    plafondInitial,
    champs,
    setChamps,
    avertissements,
    erreurs,
    info,
    setInfo,
    enregistrement,
    confirmation,
    setConfirmation,
    enregistrerPlafond,
    enregistrerDuree,
    enregistrerMotif,
    deposer,
    soumettre,
    abandonner,
  };
}
