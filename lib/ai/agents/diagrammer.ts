import {
  streamText,
  smoothStream,
  stepCountIs,
  convertToModelMessages,
  type UIMessageStreamWriter,
} from 'ai';
import { mcpTools } from '@/lib/ai/tools/mcp/aws-mcp';
import { requestClarification } from '@/lib/ai/tools/request-clarification';
import { myProvider } from '@/lib/ai/providers';
import { isProductionEnvironment } from '@/lib/constants';
import type { AgentRunner } from './types';
import { diagramSystemPrompt } from './system-prompts';
import { sanitizeUIMessages } from '@/lib/utils';
import type { ChatMessage } from '@/lib/types';
import type { Session } from 'next-auth';
import * as fs from 'node:fs/promises';


export const runDiagramAgent: AgentRunner = ({
  selectedChatModel,
  uiMessages,
  session,
  input,
  dataStream,
  telemetryId = 'agent-diagram',
  chatId,
}: {
  selectedChatModel: string;
  uiMessages: ChatMessage[];
  session: Session;
  input: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  telemetryId?: string;
  chatId?: string;
}) => {
  const diagramTools = mcpTools.diagram;
  const child = streamText({
    model: myProvider.languageModel(selectedChatModel),
    system: diagramSystemPrompt(chatId ?? 'default-diagram'),

    messages: [
      ...convertToModelMessages(sanitizeUIMessages(uiMessages)),
      { role: 'user', content: input },
    ],
    stopWhen: stepCountIs(8),
    tools: {
      ...diagramTools,
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
    onFinish: async (result) => {
      const imagePath = `./workspace/generated-diagrams/${chatId}.png`;
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      console.log(`[Diagram Agent] Successfully read image from: ${imagePath}`);

      dataStream.write({
        type: 'file',
        url: `data:image/png;base64,${base64Image}`,
        mediaType: 'image/png',
      });
    },
  });

  return child;
};

