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
import { sanitizeUIMessages } from '@/lib/utils';
import { createDocument } from '../tools/create-document';
import { updateDocument } from '../tools/update-document';

export const runCoreAgent: AgentRunner = ({
  selectedChatModel,
  uiMessages,
  input,
  session,
  dataStream,
  telemetryId = 'agent-core',
  chatId,
}) => {
  try {
    const child = streamText({
      model: myProvider.languageModel(selectedChatModel),
      system: coreSystemPrompt,
      messages: [
        ...convertToModelMessages(sanitizeUIMessages(uiMessages)),
        { role: 'user', content: input },
      ],
      stopWhen: stepCountIs(5), // Allow enough steps: analyze + clarify + use tools + generate prompt + finalize
      tools: {
        ...mcpTools.core,
        requestClarification: requestClarification({
          dataStream,
          agentName: 'core_agent',
          chatId: chatId as string,
        }),
        // createDocument: createDocument({ session, dataStream }),
        // updateDocument: updateDocument({ session, dataStream }),
      },
      experimental_transform: smoothStream({ chunking: 'word' }),
      experimental_telemetry: {
        isEnabled: isProductionEnvironment,
        functionId: telemetryId,
      },
    });

    return child;
  } catch (err) {
    console.error('Error creating core agent stream:', err);
    return streamText({
      model: myProvider.languageModel(selectedChatModel),
      system:
        'You are having technical difficulties. Explain that core agent is temporarily unavailable.',
      messages: [
        {
          role: 'user',
          content:
            'Core agent is temporarily unavailable. Please try again later.',
        },
      ],
      experimental_telemetry: {
        isEnabled: isProductionEnvironment,
        functionId: `${telemetryId}-fallback`,
      },
    });
  }
};
