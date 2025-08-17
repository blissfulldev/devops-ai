import {
  streamText,
  smoothStream,
  stepCountIs,
  convertToModelMessages,
} from 'ai';
import { mcpTools } from '@/lib/ai/tools/mcp/aws-mcp';
import { writeTerraformToDisk } from '@/lib/ai/tools/write-terraform-to-disk';
import { requestClarification } from '@/lib/ai/tools/request-clarification';
import { myProvider } from '@/lib/ai/providers';
import { isProductionEnvironment } from '@/lib/constants';
import type { AgentRunner } from './types';
import { terraformSystemPrompt } from './system-prompts';
import { sanitizeUIMessages } from '@/lib/utils';

export const runTerraformAgent: AgentRunner = ({
  selectedChatModel,
  uiMessages,
  input,
  dataStream,
  telemetryId = 'agent-terraform',
  chatId,
}) => {
  const child = streamText({
    model: myProvider.languageModel(selectedChatModel),
    system: terraformSystemPrompt,
    messages: [
      ...convertToModelMessages(sanitizeUIMessages(uiMessages)),
      { role: 'user', content: input },
    ],
    tools: {
      ...mcpTools.terraform,
      writeTerraformToDisk: writeTerraformToDisk(),
      requestClarification: requestClarification({
        dataStream,
        agentName: 'terraform_agent',
        chatId: chatId as string,
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
