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
import { diagramSystemPrompt } from './system-prompts';
import { sanitizeUIMessages } from '@/lib/utils';

export const runDiagramAgent: AgentRunner = ({
  selectedChatModel,
  uiMessages,
  input,
  dataStream,
  telemetryId = 'agent-diagram',
  chatId,
}) => {
  const child = streamText({
    model: myProvider.languageModel(selectedChatModel),
    system: diagramSystemPrompt,
    messages: [
      ...convertToModelMessages(sanitizeUIMessages(uiMessages)),
      { role: 'user', content: input },
    ],
    stopWhen: stepCountIs(3),
    tools: {
      ...mcpTools.diagram,
      requestClarification: requestClarification({
        dataStream,
        agentName: 'diagram_agent',
        chatId: chatId as string,
      }),
    },
    experimental_transform: smoothStream({ chunking: 'word' }),
    experimental_telemetry: {
      isEnabled: isProductionEnvironment,
      functionId: telemetryId,
    },
  });

  return child;
};
