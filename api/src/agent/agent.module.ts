import { Module } from '@nestjs/common';
import { DemandesModule } from '../demandes/demandes.module';
import { HistoriqueService } from '../historique/historique.service';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { LLM_CLIENT, type LlmClient } from './llm-client';
import { LlmSimule } from './llm-simule';
import { OutilsService } from './outils.service';

// Le modèle est choisi par LLM_MODE : « mock » par défaut, partout (Docker, développement,
// tests). Le mode connecté (SDK Anthropic) viendra à l'étape 7c.
function creerModele(): LlmClient {
  const mode = process.env.LLM_MODE ?? 'mock';
  if (mode === 'mock') {
    return new LlmSimule();
  }
  throw new Error(`LLM_MODE inconnu : ${mode} (seul « mock » est disponible pour l'instant).`);
}

@Module({
  imports: [DemandesModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    OutilsService,
    HistoriqueService,
    { provide: LLM_CLIENT, useFactory: creerModele },
  ],
})
export class AgentModule {}
