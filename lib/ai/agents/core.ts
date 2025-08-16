import {
  streamText,
  smoothStream,
  stepCountIs,
  convertToModelMessages,
} from 'ai';
import { mcpTools } from '@/lib/ai/tools/mcp/aws-mcp';
import { requestClarification } from '@/lib/ai/tools/request-clarification';
import { myProvider } from '@/lib/ai/providers';
import { isProductionEnvironment } from '@/lib/constants';
import type { AgentRunner } from './types';
import { coreSystemPrompt } from './system-prompts';

export const runCoreAgent: AgentRunner = ({
  selectedChatModel,
  uiMessages,
  input,
  session,
  dataStream,
  telemetryId = 'agent-core',
  chatId,
}) => {
  const child = streamText({
    model: myProvider.languageModel(selectedChatModel),
    system: coreSystemPrompt,
    messages: [
      ...convertToModelMessages(uiMessages),
      { role: 'user', content: input },
    ],
    tools: {
      ...mcpTools.core,
      requestClarification: requestClarification({
        session,
        dataStream,
        agentName: 'core_agent',
      }),
    },
    stopWhen: stepCountIs(5),
    experimental_transform: smoothStream({ chunking: 'word' }),
    experimental_telemetry: {
      isEnabled: isProductionEnvironment,
      functionId: telemetryId,
    },
  });

  return child;
};
