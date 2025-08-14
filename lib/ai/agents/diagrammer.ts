import {
  streamText,
  smoothStream,
  stepCountIs,
  convertToModelMessages,
  type UIMessageStreamWriter,
} from 'ai';
import { mcpTools } from '@/lib/ai/tools/mcp/aws-mcp';
import { myProvider } from '@/lib/ai/providers';
import { isProductionEnvironment } from '@/lib/constants';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { Session } from 'next-auth';
import type { AgentRunner } from './types';
import { diagramSystemPrompt } from './system-prompts';

export const runDiagramAgent: AgentRunner = ({
  selectedChatModel,
  uiMessages,
  input,
  telemetryId = 'agent-diagram',
}: {
  selectedChatModel: ChatModel['id'];
  uiMessages: ChatMessage[];
  input: string;
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  telemetryId?: string;
}) => {
  const child = streamText({
    model: myProvider.languageModel(selectedChatModel),
    system: diagramSystemPrompt,
    messages: [
      ...convertToModelMessages(uiMessages),
      { role: 'user', content: input },
    ],
    tools: mcpTools.diagram,
    stopWhen: stepCountIs(5),
    experimental_transform: smoothStream({ chunking: 'word' }),
    experimental_telemetry: {
      isEnabled: isProductionEnvironment,
      functionId: telemetryId,
    },
  });

  return child;
};
