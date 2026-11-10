import { creerModele } from './agent.module';
import type { MessageModele } from './llm-client';
import { ADRESSE_GROQ, ErreurGroq, LlmGroq } from './llm-groq';
import { LlmSimule } from './llm-simule';
import { DESCRIPTIONS_OUTILS } from './outils';

// Le client Groq, sans aucun appel réseau : `fetch` est remplacé par un double qui enregistre la
// requête et renvoie une réponse écrite à la main, au format de l'API.
const CLE = 'gsk_cle-de-test-factice';

function fauxFetch(reponse: { status?: number; corps: unknown } | Error) {
  const requetes: { url: string; init: RequestInit }[] = [];
  // Le client n'appelle fetch qu'avec une adresse sous forme de texte.
  const appel: typeof fetch = (url, init) => {
    requetes.push({ url: url as string, init: init! });
    if (reponse instanceof Error) {
      return Promise.reject(reponse);
    }
    return Promise.resolve(
      new Response(JSON.stringify(reponse.corps), { status: reponse.status ?? 200 }),
    );
  };
  return { appel, requetes };
}

const corpsEnvoye = (requete: { init: RequestInit }) =>
  JSON.parse(requete.init.body as string) as Record<string, unknown>;

const HISTORIQUE: MessageModele[] = [
  { role: 'client', texte: 'Quel est mon plafond ?' },
  {
    role: 'agent',
    texte: '',
    appels: [{ id: 'appel-1', nom: 'consulter_comptes', arguments: {} }],
  },
  {
    role: 'outil',
    idAppel: 'appel-1',
    nom: 'consulter_comptes',
    resultat: { comptes: [] },
    erreur: false,
  },
];

describe('LlmGroq : la requête envoyée', () => {
  it('appelle l’API Groq avec la clé en Bearer, les outils, tool_choice auto et 1 024 tokens', async () => {
    const { appel, requetes } = fauxFetch({
      corps: { choices: [{ message: { content: 'Bonjour' } }] },
    });

    await new LlmGroq(CLE, 'openai/gpt-oss-120b', ADRESSE_GROQ, appel).repondre({
      consignes: 'Consignes',
      messages: HISTORIQUE,
      outils: DESCRIPTIONS_OUTILS,
    });

    expect(requetes[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(requetes[0].init.headers).toMatchObject({ Authorization: `Bearer ${CLE}` });
    const corps = corpsEnvoye(requetes[0]);
    expect(corps).toMatchObject({
      model: 'openai/gpt-oss-120b',
      tool_choice: 'auto',
      max_completion_tokens: 1024,
    });
    expect((corps.tools as { function: { name: string } }[]).map((t) => t.function.name)).toEqual([
      'consulter_comptes',
      'consulter_dossier',
      'preparer_brouillon',
      'proposer_soumission',
    ]);
  });

  it('convertit les messages : system, user, assistant avec tool_calls, tool sans champ name', async () => {
    const { appel, requetes } = fauxFetch({ corps: { choices: [{ message: { content: 'ok' } }] } });

    await new LlmGroq(CLE, 'modele', ADRESSE_GROQ, appel).repondre({
      consignes: 'Consignes',
      messages: HISTORIQUE,
      outils: [],
    });

    expect(corpsEnvoye(requetes[0]).messages).toEqual([
      { role: 'system', content: 'Consignes' },
      { role: 'user', content: 'Quel est mon plafond ?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'appel-1',
            type: 'function',
            function: { name: 'consulter_comptes', arguments: '{}' },
          },
        ],
      },
      // Groq refuse messages[].name : il n'y en a pas.
      { role: 'tool', tool_call_id: 'appel-1', content: '{"comptes":[]}' },
    ]);
  });
});

describe('LlmGroq : la réponse reçue', () => {
  async function repondre(corps: unknown) {
    const { appel } = fauxFetch({ corps });
    return new LlmGroq(CLE, 'modele', ADRESSE_GROQ, appel).repondre({
      consignes: '',
      messages: [],
      outils: [],
    });
  }

  it('lit le texte et les appels d’outils, plusieurs dans la même réponse', async () => {
    const reponse = await repondre({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              { id: 'a', function: { name: 'consulter_comptes', arguments: '{}' } },
              { id: 'b', function: { name: 'consulter_dossier', arguments: '{"demandeId":"x"}' } },
            ],
          },
        },
      ],
    });

    expect(reponse).toEqual({
      texte: '',
      appels: [
        { id: 'a', nom: 'consulter_comptes', arguments: {} },
        { id: 'b', nom: 'consulter_dossier', arguments: { demandeId: 'x' } },
      ],
    });
  });

  it('transmet tels quels des arguments illisibles : le serveur les refusera', async () => {
    const reponse = await repondre({
      choices: [
        {
          message: {
            tool_calls: [
              { id: 'a', function: { name: 'preparer_brouillon', arguments: '{pas du json' } },
            ],
          },
        },
      ],
    });

    expect(reponse.appels[0].arguments).toBe('{pas du json');
  });

  it('une réponse coupée par la limite de tokens n’exécute aucun outil et le dit', async () => {
    const reponse = await repondre({
      choices: [
        {
          finish_reason: 'length',
          message: {
            content: 'Votre plafond',
            tool_calls: [
              { id: 'a', function: { name: 'preparer_brouillon', arguments: '{"compteId":"' } },
            ],
          },
        },
      ],
    });

    expect(reponse.appels).toEqual([]);
    expect(reponse.texte).toMatch(/incomplète/);
  });
});

describe('LlmGroq : les erreurs', () => {
  it.each([
    [401, 'invalid_api_key'],
    [429, 'rate_limit_exceeded'],
    [503, 'service_unavailable'],
  ])(
    'une réponse %i lève une erreur avec le statut et le type, jamais la clé',
    async (status, type) => {
      const { appel } = fauxFetch({ status, corps: { error: { message: `détail ${CLE}`, type } } });

      const promesse = new LlmGroq(CLE, 'modele', ADRESSE_GROQ, appel).repondre({
        consignes: '',
        messages: [],
        outils: [],
      });

      await expect(promesse).rejects.toThrow(ErreurGroq);
      await expect(promesse).rejects.toThrow(new RegExp(`${status}.*${type}`));
      await expect(promesse).rejects.not.toThrow(CLE);
    },
  );

  it('un délai dépassé ou une connexion impossible lève une erreur explicite', async () => {
    const delai = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });

    await expect(
      new LlmGroq(CLE, 'm', ADRESSE_GROQ, fauxFetch(delai).appel).repondre({
        consignes: '',
        messages: [],
        outils: [],
      }),
    ).rejects.toThrow('Délai dépassé (15 s).');
    await expect(
      new LlmGroq(CLE, 'm', ADRESSE_GROQ, fauxFetch(new TypeError('fetch failed')).appel).repondre({
        consignes: '',
        messages: [],
        outils: [],
      }),
    ).rejects.toThrow('Groq injoignable.');
  });
});

describe('Choix du modèle (LLM_MODE)', () => {
  it('mode simulé par défaut', () => {
    expect(creerModele({})).toBeInstanceOf(LlmSimule);
  });

  it('mode connecté : Groq, et refus de démarrer sans clé', () => {
    expect(creerModele({ LLM_MODE: 'connecte', GROQ_API_KEY: CLE })).toBeInstanceOf(LlmGroq);
    expect(() => creerModele({ LLM_MODE: 'connecte' })).toThrow(/GROQ_API_KEY/);
    expect(() => creerModele({ LLM_MODE: 'autre' })).toThrow(/LLM_MODE inconnu/);
  });
});

describe('Adresse du modèle (LLM_URL)', () => {
  // Un serveur compatible OpenAI hébergé en interne : seule l'adresse change.
  const ADRESSE_INTERNE = 'http://modele-interne:8000/v1/chat/completions';
  const REPONSE = { choices: [{ message: { content: 'ok' } }] };
  const ENTREE = { consignes: '', messages: [], outils: [] };

  afterEach(() => jest.restoreAllMocks());

  it('le client appelle l’adresse qu’on lui donne', async () => {
    const { appel, requetes } = fauxFetch({ corps: REPONSE });

    await new LlmGroq(CLE, 'modele', ADRESSE_INTERNE, appel).repondre(ENTREE);

    expect(requetes[0].url).toBe(ADRESSE_INTERNE);
  });

  it('LLM_URL remplace l’adresse de Groq ; sans LLM_URL, Groq reste l’adresse par défaut', async () => {
    // fetch global remplacé : aucun appel réseau.
    const appel = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(REPONSE))));

    const connecte = { LLM_MODE: 'connecte', GROQ_API_KEY: CLE };
    await creerModele({ ...connecte, LLM_URL: ADRESSE_INTERNE }).repondre(ENTREE);
    await creerModele(connecte).repondre(ENTREE);

    expect(appel.mock.calls.map(([url]) => url)).toEqual([ADRESSE_INTERNE, ADRESSE_GROQ]);
  });
});
