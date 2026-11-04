import type { Pool } from 'pg';
import { LLM_CLIENT } from '../src/agent/llm-client';
import { LlmGroq } from '../src/agent/llm-groq';
import type { ElementReponse } from '../src/agent/outils';
import { executerTransaction } from '../src/base/transaction';
import { creerComptesDemo } from '../src/demo/comptes-demo';
import { codesDe, demarrerAppTest } from './app-test';
import { creerPoolTest, viderBase } from './outils-base';

// Le mode connecté de bout en bout, SANS réseau : le vrai client Groq, l'agent, les outils et la
// base, avec un faux `fetch` qui joue les réponses de l'API, appel après appel.
type CorpsEnvoye = { messages: { role: string; tool_call_id?: string; content: string | null }[] };

describe('Agent IA en mode connecté (Groq, réseau simulé)', () => {
  let pool: Pool;
  let appTest: Awaited<ReturnType<typeof demarrerAppTest>>;
  let reponsesAJouer: { status: number; corps: unknown }[] = [];
  const requetes: CorpsEnvoye[] = [];

  const fauxFetch = ((_url: string, init?: RequestInit) => {
    requetes.push(JSON.parse(init!.body as string) as CorpsEnvoye);
    const { status, corps } = reponsesAJouer.shift()!;
    return Promise.resolve(new Response(JSON.stringify(corps), { status }));
  }) as typeof fetch;

  beforeAll(async () => {
    pool = creerPoolTest();
    const groq = new LlmGroq('gsk_cle-factice', 'llama-3.3-70b-versatile', fauxFetch);
    appTest = await demarrerAppTest([], (c) => c.overrideProvider(LLM_CLIENT).useValue(groq));
  });

  beforeEach(async () => {
    await viderBase(pool);
    await executerTransaction(pool, creerComptesDemo);
    requetes.length = 0;
  });

  afterAll(async () => {
    await appTest.arreter();
    await pool.end();
  });

  it('le modèle appelle un outil, reçoit son résultat, puis répond', async () => {
    reponsesAJouer = [
      {
        status: 200,
        corps: {
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: null,
                tool_calls: [
                  { id: 'g1', function: { name: 'consulter_comptes', arguments: '{}' } },
                ],
              },
            },
          ],
        },
      },
      {
        status: 200,
        corps: {
          choices: [
            { finish_reason: 'stop', message: { content: 'Votre plafond est de 10 000 DH.' } },
          ],
        },
      },
    ];
    const amal = await appTest.connecter('client.amal@portail.test');

    const reponse = await appTest
      .http()
      .post('/api/agent/messages')
      .set('Cookie', amal)
      .send({ message: 'Mon plafond ?' });

    expect(reponse.status).toBe(200);
    const elements = (reponse.body as { elements: ElementReponse[] }).elements;
    expect(elements.map((e) => e.type)).toEqual(['donnee', 'explication']);
    // Au second appel, le modèle a reçu le résultat de l'outil, avec le bon identifiant.
    const resultat = requetes[1].messages.find((m) => m.role === 'tool')!;
    expect(resultat.tool_call_id).toBe('g1');
    expect(resultat.content).toContain('DEMO-0001');
  });

  it('une clé refusée par Groq (401) : le chat est indisponible, rien ne fuit', async () => {
    reponsesAJouer = [
      {
        status: 401,
        corps: { error: { message: 'Invalid API Key', type: 'invalid_request_error' } },
      },
    ];
    const amal = await appTest.connecter('client.amal@portail.test');

    const reponse = await appTest
      .http()
      .post('/api/agent/messages')
      .set('Cookie', amal)
      .send({ message: 'Bonjour' });

    expect(reponse.status).toBe(503);
    expect(codesDe(reponse)).toEqual(['IA_INDISPONIBLE']);
    expect(reponse.text).not.toMatch(/gsk_|Invalid API Key|401/);
  });
});
