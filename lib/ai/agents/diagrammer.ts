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

export const runDiagramAgent: AgentRunner = ({
  selectedChatModel,
  uiMessages,
  input,
  session,
  dataStream,
  telemetryId = 'agent-diagram',
  chatId,
}) => {
  const child = streamText({
    model: myProvider.languageModel(selectedChatModel),
    system: diagramSystemPrompt,
    messages: [
      ...convertToModelMessages(uiMessages),
      { role: 'user', content: input },
    ],
    tools: {
      ...mcpTools.diagram,
      requestClarification: requestClarification({
        session,
        dataStream,
        agentName: 'diagram_agent',
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
