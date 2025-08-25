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
import { terraformSystemPrompt } from './system-prompts';
import { sanitizeUIMessages } from '@/lib/utils';
import { mkdirSync } from 'node:fs';
import { writeTerraformToDisk } from '../tools/write-terraform-to-disk';
import { fixToolCallArgs } from './utils';

export const runTerraformAgent: AgentRunner = ({
  selectedChatModel,
  uiMessages,
  input,
  session,
  dataStream,
  telemetryId = 'agent-terraform',
  chatId,
}) => {
  // Check if terraform tools are available
  const terraformTools = (mcpTools as any).terraform || {};
  const hasTools = Object.keys(terraformTools).length > 0;

  if (!hasTools) {
    console.warn('Terraform MCP tools not available, using fallback mode');
  }

  // Set the actual directory path where Terraform files should be written
  const actualProjectRoot = `/home/DevOps/Projects/devops-ai/workspace/terraform-projects/${chatId}`; // TODO: Replace with dynamic value as needed
  mkdirSync(actualProjectRoot, { recursive: true });
  // Get the parameterized prompt
  const promptWithProjectRoot = terraformSystemPrompt(
    `/app/terraform-projects/terraform-projects/${chatId}`,
    actualProjectRoot,
  );

  try {
    const child = streamText({
      model: myProvider.languageModel(selectedChatModel),
      system: hasTools
        ? promptWithProjectRoot
        : `${promptWithProjectRoot}\n\nNOTE: Some Terraform tools are currently unavailable. Focus on generating Terraform code using your knowledge.`,
      messages: [
        ...convertToModelMessages(
          fixToolCallArgs(sanitizeUIMessages(uiMessages)),
        ),
        { role: 'user', content: input },
      ],
      tools: {
        ...(terraformTools as Record<string, any>),
        requestClarification: requestClarification({
          dataStream,
          agentName: 'terraform_agent',
          chatId: chatId as string,
        }),
        writeTerraformToDisk: writeTerraformToDisk(actualProjectRoot),
      },
      stopWhen: stepCountIs(30),
      experimental_transform: smoothStream({ chunking: 'word' }),
      experimental_telemetry: {
        isEnabled: isProductionEnvironment,
        functionId: telemetryId,
      },
    });

    return child;
  } catch (err) {
    console.error('Error creating terraform agent stream:', err);
  }
};
