import {
  type AppelOutil,
  DELAI_MODELE_MS,
  type DescriptionOutil,
  type LlmClient,
  type MessageModele,
  type ReponseModele,
} from './llm-client';

// Le mode CONNECTÉ (LLM_MODE=connecte) : l'API Groq, au format compatible OpenAI, appelée par
// fetch (intégré à Node, sans dépendance).
// Cette classe ne fait que traduire : la boucle, les garde-fous et TOUS les contrôles restent
// dans l'agent et dans les services, quoi que le modèle réponde.

// Adresse par défaut : Groq. Tout serveur compatible OpenAI (par exemple un modèle hébergé en
// interne) peut la remplacer par la variable LLM_URL, sans autre changement de code.
export const ADRESSE_GROQ = 'https://api.groq.com/openai/v1/chat/completions';
// Garde-fou : 1 024 tokens de réponse au plus.
const TOKENS_MAXIMUM = 1024;

// Le format des messages de l'API (compatible OpenAI), réduit à ce que l'agent utilise.
type MessageGroq =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    }
  // Sans champ `name` : Groq refuse messages[].name (erreur 400).
  | { role: 'tool'; tool_call_id: string; content: string };

type ReponseGroq = {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
};

// Une erreur de l'appel : le statut et le type, JAMAIS la clé ni le contenu de la conversation.
export class ErreurGroq extends Error {}

export class LlmGroq implements LlmClient {
  constructor(
    private readonly cle: string,
    private readonly modele: string,
    private readonly adresse: string = ADRESSE_GROQ,
    // Remplaçable dans les tests : aucun test ne fait d'appel réseau.
    private readonly appelHttp: typeof fetch = fetch,
  ) {}

  async repondre(entree: {
    consignes: string;
    messages: MessageModele[];
    outils: DescriptionOutil[];
  }): Promise<ReponseModele> {
    let reponse: Response;
    try {
      reponse = await this.appelHttp(this.adresse, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cle}` },
        body: JSON.stringify({
          model: this.modele,
          messages: versGroq(entree.consignes, entree.messages),
          tools: entree.outils.map((o) => ({
            type: 'function',
            function: { name: o.nom, description: o.description, parameters: o.schema },
          })),
          // Le modèle choisit librement ; il ne peut appeler que des outils, jamais agir seul.
          tool_choice: 'auto',
          max_completion_tokens: TOKENS_MAXIMUM,
          // Des réponses régulières (une valeur au-dessus de 0, comme le conseille Groq).
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(DELAI_MODELE_MS),
      });
    } catch (erreur) {
      const delai = erreur instanceof Error && erreur.name === 'TimeoutError';
      throw new ErreurGroq(delai ? 'Délai dépassé (15 s).' : 'Groq injoignable.');
    }

    if (!reponse.ok) {
      // 401 clé refusée, 429 limite de débit, 5xx panne : seulement le statut et le type.
      const type = await typeDErreur(reponse);
      throw new ErreurGroq(`Groq a répondu ${reponse.status}${type ? ` (${type})` : ''}.`);
    }

    return lireReponse((await reponse.json()) as ReponseGroq);
  }
}

// Nos messages, au format de l'API. Les résultats d'outils deviennent des messages `tool`.
export function versGroq(consignes: string, messages: MessageModele[]): MessageGroq[] {
  const resultat: MessageGroq[] = [{ role: 'system', content: consignes }];
  for (const m of messages) {
    if (m.role === 'client') {
      resultat.push({ role: 'user', content: m.texte });
    } else if (m.role === 'agent') {
      resultat.push({
        role: 'assistant',
        content: m.texte || null,
        ...(m.appels.length > 0
          ? {
              tool_calls: m.appels.map((a) => ({
                id: a.id,
                type: 'function' as const,
                function: {
                  name: a.nom,
                  arguments:
                    typeof a.arguments === 'string' ? a.arguments : JSON.stringify(a.arguments),
                },
              })),
            }
          : {}),
      });
    } else {
      resultat.push({
        role: 'tool',
        tool_call_id: m.idAppel,
        // En mémoire, le résultat est déjà un résumé textuel ; sinon, il est sérialisé ici.
        content: typeof m.resultat === 'string' ? m.resultat : JSON.stringify(m.resultat),
      });
    }
  }
  return resultat;
}

// La réponse de l'API, dans notre format.
export function lireReponse(corps: ReponseGroq): ReponseModele {
  const choix = corps.choices?.[0];
  const texte = choix?.message?.content ?? '';
  // Réponse coupée par la limite de tokens : un appel d'outil pourrait être incomplet, il est
  // ignoré ; le client voit que la réponse est incomplète.
  if (choix?.finish_reason === 'length') {
    return {
      texte: `${texte}${texte ? ' ' : ''}(Réponse incomplète : reformulez plus brièvement.)`,
      appels: [],
    };
  }
  const appels: AppelOutil[] = (choix?.message?.tool_calls ?? []).map((a) => ({
    id: a.id,
    nom: a.function.name,
    arguments: analyser(a.function.arguments),
  }));
  return { texte, appels };
}

// Les arguments sont du texte JSON produit par le modèle : une donnée NON FIABLE. Illisibles, ils
// sont transmis tels quels (du texte) : le serveur les refuse alors (VALIDATION) et trace le refus.
function analyser(texte: string): unknown {
  try {
    return JSON.parse(texte) as unknown;
  } catch {
    return texte;
  }
}

async function typeDErreur(reponse: Response): Promise<string | null> {
  try {
    const corps = (await reponse.json()) as { error?: { type?: string } };
    return corps.error?.type ?? null;
  } catch {
    return null;
  }
}
