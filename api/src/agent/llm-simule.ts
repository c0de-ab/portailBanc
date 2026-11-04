import type { AppelOutil, LlmClient, MessageModele, ReponseModele } from './llm-client';

// Le modèle SIMULÉ (LLM_MODE=mock, par défaut) : des réponses déterministes, par motifs, sans
// aucun appel réseau. Il couvre au minimum le parcours normal, le brouillon de 60 000 DH sans
// justificatif (R4, scénario 2), le dossier incomplet (R5), la demande de contournement et
// l'accès au compte d'un autre client (scénario 7).
// Il joue le rôle du modèle : il choisit les outils, et c'est le serveur qui décide de tout.

type Intention = 'contournement' | 'autre-client' | 'demande' | 'etat' | 'plafond' | 'aide';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export class LlmSimule implements LlmClient {
  repondre(entree: { messages: MessageModele[] }): Promise<ReponseModele> {
    return Promise.resolve(decider(entree.messages));
  }
}

function decider(messages: MessageModele[]): ReponseModele {
  // Le dernier message du client, et les résultats d'outils reçus depuis.
  const indexClient = messages.map((m) => m.role).lastIndexOf('client');
  const dernier = messages[indexClient];
  const texte = dernier?.role === 'client' ? dernier.texte : '';
  const resultats = new Map<string, { resultat: unknown; erreur: boolean }>();
  for (const m of messages.slice(indexClient + 1)) {
    if (m.role === 'outil') {
      resultats.set(m.nom, { resultat: m.resultat, erreur: m.erreur });
    }
  }

  switch (intentionDe(texte)) {
    case 'contournement':
      return dire(
        'Je ne peux ni approuver, ni rejeter, ni activer une demande, ni contourner une règle : ' +
          'ces décisions appartiennent au conseiller et au superviseur, et le serveur les contrôle.',
      );

    case 'autre-client': {
      const id = UUID.exec(texte)?.[0];
      if (!id) {
        return dire('Je n’ai accès qu’à vos propres comptes et à vos propres demandes.');
      }
      const dossier = resultats.get('consulter_dossier');
      if (!dossier) {
        return appeler('consulter_dossier', { demandeId: id });
      }
      return dire(
        dossier.erreur
          ? 'Je n’ai pas accès à ce dossier : je ne vois que vos propres demandes.'
          : 'Voici l’état de votre demande.',
      );
    }

    case 'demande':
      return parcoursDemande(texte, resultats);

    case 'etat': {
      const dossier = resultats.get('consulter_dossier');
      if (!dossier) {
        return appeler('consulter_dossier', {});
      }
      const { demandes } = dossier.resultat as {
        demandes: { reference: string | null; statut: string }[];
      };
      return dire(
        demandes.length === 0
          ? 'Vous n’avez encore aucune demande.'
          : `Vos demandes : ${demandes.map((d) => `${d.reference ?? 'brouillon'} (${d.statut})`).join(', ')}.`,
      );
    }

    case 'plafond': {
      const comptes = resultats.get('consulter_comptes');
      if (!comptes) {
        return appeler('consulter_comptes', {});
      }
      return dire(resumeComptes(comptes.resultat as ResultatComptes));
    }

    case 'aide':
      return dire(
        'Je peux vous indiquer votre plafond, l’état de vos demandes, et préparer une demande ' +
          'd’augmentation temporaire : précisez le montant total, la durée (1 à 7 jours) et le motif.',
      );
  }
}

type ResultatComptes = {
  comptes: { id: string; plafondCourant: number; demandeEnCours: { statut: string } | null }[];
  dossierComplet: boolean;
};

// Le parcours normal, en trois appels au plus : comptes, brouillon, carte de confirmation.
function parcoursDemande(
  texte: string,
  resultats: Map<string, { resultat: unknown; erreur: boolean }>,
) {
  const comptes = resultats.get('consulter_comptes');
  if (!comptes) {
    return appeler('consulter_comptes', {});
  }
  const { comptes: liste, dossierComplet } = comptes.resultat as ResultatComptes;
  // H23 : prévenir dès le début, sans rien préparer.
  if (!dossierComplet) {
    return dire(
      'Votre dossier client est incomplet : aucune demande ne peut être soumise pour le moment. ' +
        'Je ne peux pas modifier ce statut ; contactez votre conseiller.',
    );
  }
  const enCours = liste[0]?.demandeEnCours;
  if (enCours && enCours.statut !== 'COMPLEMENT_DEMANDE') {
    return dire(
      `Ce compte a déjà une demande en cours (${enCours.statut}) : une seule à la fois (R6).`,
    );
  }

  const brouillon = resultats.get('preparer_brouillon');
  if (!brouillon) {
    // Le client vient de le demander explicitement : montant, durée et motif dans son message.
    return appeler('preparer_brouillon', { compteId: liste[0].id, ...extraire(texte) });
  }
  if (brouillon.erreur) {
    return dire('Je n’ai pas pu enregistrer le brouillon : rien n’a été modifié.');
  }
  const { demande, avertissements } = brouillon.resultat as {
    demande: { id: string };
    avertissements: { message: string }[];
  };
  if (avertissements.length > 0) {
    return dire(
      `Brouillon enregistré, mais il reste à compléter : ${avertissements.map((a) => a.message).join(' ')}`,
    );
  }

  const carte = resultats.get('proposer_soumission');
  if (!carte) {
    return appeler('proposer_soumission', { demandeId: demande.id });
  }
  return dire(
    carte.erreur
      ? 'La demande ne peut pas encore être soumise.'
      : 'Vérifiez les informations de la carte : la demande ne sera soumise que lorsque vous la confirmerez.',
  );
}

function intentionDe(texte: string): Intention {
  const t = normaliser(texte);
  if (
    /approuv|valide[rz]? (ma|la)|contourn|ignore|outrepass|active[rz]? (mon|le|la)|force[rz]?|sans (le |la )?(conseiller|superviseur|justificatif)/.test(
      t,
    )
  ) {
    return 'contournement';
  }
  if (UUID.test(texte) || /autre client|d'un autre|d’un autre/.test(t)) {
    return 'autre-client';
  }
  if (/\d[\d\s.]*\s*(dh|dirham)/.test(t)) {
    return 'demande';
  }
  if (/etat|statut|ou en est|mes demandes|ma demande/.test(t)) {
    return 'etat';
  }
  if (/plafond|compte/.test(t)) {
    return 'plafond';
  }
  return 'aide';
}

// Montant, durée et motif d'un message comme « 25 000 DH pour 3 jours, motif : achat ».
function extraire(texte: string): { plafondDemande?: number; dureeJours?: number; motif?: string } {
  const t = normaliser(texte);
  const montant = /(\d[\d\s.]*)\s*(dh|dirham)/.exec(t)?.[1].replace(/[\s.]/g, '');
  const duree = /(\d+)\s*jours?/.exec(t)?.[1];
  const motif = /motif\s*:?\s*(.+)$/i.exec(texte)?.[1].trim();
  return {
    ...(montant ? { plafondDemande: Number(montant) } : {}),
    ...(duree ? { dureeJours: Number(duree) } : {}),
    ...(motif ? { motif } : {}),
  };
}

function resumeComptes({ comptes, dossierComplet }: ResultatComptes): string {
  const [compte] = comptes;
  const parties = [
    `Votre plafond actuel est de ${compte.plafondCourant.toLocaleString('fr-FR')} DH.`,
  ];
  if (compte.demandeEnCours) {
    parties.push(`Une demande est en cours (${compte.demandeEnCours.statut}).`);
  }
  if (!dossierComplet) {
    parties.push('Votre dossier client est incomplet : aucune demande ne peut être soumise.');
  }
  return parties.join(' ');
}

function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

let compteur = 0;
function appeler(nom: string, args: Record<string, unknown>): ReponseModele {
  const appel: AppelOutil = { id: `simule-${++compteur}`, nom, arguments: args };
  return { texte: '', appels: [appel] };
}

function dire(texte: string): ReponseModele {
  return { texte, appels: [] };
}
