import { Module } from '@nestjs/common';
import { DemandesModule } from '../demandes/demandes.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { LLM_CLIENT, type LlmClient } from './llm-client';
import { ADRESSE_GROQ, LlmGroq } from './llm-groq';
import { LlmSimule } from './llm-simule';
import { OutilsService } from './outils.service';

const MODELE_GROQ_PAR_DEFAUT = 'openai/gpt-oss-120b';

// Le modèle est choisi par LLM_MODE : « mock » par défaut, partout (Docker, développement,
// tests) ; « connecte » pour l'API Groq, avec une clé fournie par configuration. LLM_URL
// remplace l'adresse de Groq par celle d'un autre serveur compatible OpenAI.
export function creerModele(env: NodeJS.ProcessEnv = process.env): LlmClient {
  const mode = env.LLM_MODE ?? 'mock';
  if (mode === 'mock') {
    return new LlmSimule();
  }
  if (mode === 'connecte') {
    // Sans clé, l'API refuse de démarrer : mieux qu'un chat qui échoue à chaque message.
    if (!env.GROQ_API_KEY) {
      throw new Error('LLM_MODE=connecte demande GROQ_API_KEY (voir .env.example).');
    }
    return new LlmGroq(
      env.GROQ_API_KEY,
      env.GROQ_MODEL ?? MODELE_GROQ_PAR_DEFAUT,
      env.LLM_URL || ADRESSE_GROQ,
    );
  }
  throw new Error(`LLM_MODE inconnu : ${mode} (attendu : mock ou connecte).`);
}

@Module({
  imports: [DemandesModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    OutilsService,
    { provide: LLM_CLIENT, useFactory: () => creerModele() },
  ],
})
export class AgentModule {}
