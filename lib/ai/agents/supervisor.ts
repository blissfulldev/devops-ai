import {
  streamText,
  stepCountIs,
  smoothStream,
  tool,
  convertToModelMessages,
  type UIMessageStreamWriter,
} from 'ai';
import { z } from 'zod';
import { myProvider } from '@/lib/ai/providers';
import { isProductionEnvironment } from '@/lib/constants';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { AgentRunner } from './types';
import { runDiagramAgent } from './diagrammer';
import { runTerraformAgent } from './terraform';
import { runCoreAgent } from './core';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { ConversationStateManager } from '@/lib/ai/conversation-state';
import type { Session } from 'next-auth';
import { supervisorSystemPrompt } from './system-prompts';
import { sanitizeUIMessages } from '@/lib/utils';

type RunSupervisorAgentParams = {
  selectedChatModel: ChatModel['id'];
  uiMessages: ChatMessage[];
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  telemetryId?: string;
  chatId: string;
};

// Registry of child agents the supervisor can call
const agents = {
  diagram_agent: runDiagramAgent,
  terraform_agent: runTerraformAgent,
  core_agent: runCoreAgent,
} satisfies Record<string, AgentRunner>;

export function runSupervisorAgent({
  selectedChatModel,
  uiMessages,
  session,
  dataStream,
  telemetryId = 'supervisor-stream-text',
  chatId,
}: RunSupervisorAgentParams) {
  // Check if we're waiting for clarification before proceeding
  const isWaiting = ConversationStateManager.isWaitingForClarification(chatId);
  console.log('isWaiting:', isWaiting);
  if (isWaiting) {
    const pendingClarifications =
      ConversationStateManager.getPendingClarifications(chatId);
    console.log('pendingClarifications:', pendingClarifications);
    // Just return a simple message without continuing the conversation
    return streamText({
      model: myProvider.languageModel(selectedChatModel),
      system:
        'You are paused waiting for user clarification. Respond with a brief message and stop.',
      messages: [
        {
          role: 'user',
          content: `Workflow is paused. Waiting for user to respond to ${pendingClarifications.length} clarification question(s).`,
        },
      ],
      // stopWhen: stepCountIs(1), // Limit to one step
      experimental_telemetry: {
        isEnabled: isProductionEnvironment,
        functionId: telemetryId,
      },
    });
  }

  const delegate = tool({
    description: `Delegate a subtask to a specialized agent. Available agents:
    - core_agent: Requirement clarification and plannin
    - diagram_agent: This allows you to generate AWS diagrams, Infrastructure diagrams, sequence diagrams, flow diagrams, and class diagrams using Python code.
    - terraform_agent: For Terraform on AWS best practices, infrastructure as code patterns, and security compliance with Checkov.
            Provides tool for prompt understanding and translation to AWS services`,
    inputSchema: z.object({
      agent: z.enum(['diagram_agent', 'terraform_agent', 'core_agent']),
      input: z.string().describe('Task to pass to the agent'),
    }),
    execute: async ({ agent, input }) => {
      // Check if we should wait for clarification before delegating
      const isWaiting =
        ConversationStateManager.isWaitingForClarification(chatId);
      if (isWaiting) {
        const pendingClarifications =
          ConversationStateManager.getPendingClarifications(chatId);
        return `Cannot delegate to ${agent} - waiting for user clarification on ${pendingClarifications.length} question(s). Please wait for user response before proceeding.`;
      }

      const runner = agents[agent as keyof typeof agents];
      if (!runner) return `Unknown agent: ${agent}`;

      // Set current agent in state
      console.log(`Delegating to ${agent} with input:`, input);
      ConversationStateManager.setCurrentAgent(chatId, agent);

      const child = runner({
        selectedChatModel,
        uiMessages,
        input,
        dataStream,
        telemetryId: `agent-${agent}`,
        chatId,
      });

      // Stream child tokens into the same UI stream
      child.consumeStream();
      dataStream.merge(child.toUIMessageStream({ sendReasoning: true }));

      // Return a short confirmation back to the calling model step as the tool result
      return `Delegated to ${agent}`;
    },
  });

  return streamText({
    model: myProvider.languageModel(selectedChatModel),
    system: supervisorSystemPrompt,
    messages: convertToModelMessages(sanitizeUIMessages(uiMessages)),
    stopWhen: stepCountIs(5),
    experimental_transform: smoothStream({ chunking: 'word' }),
    tools: {
      delegate,
      // Optionally allow supervisor to use base tools directly too:
      createDocument: createDocument({ session, dataStream }),
      updateDocument: updateDocument({ session, dataStream }),
      requestSuggestions: requestSuggestions({ session, dataStream }),
    },
    experimental_telemetry: {
      isEnabled: isProductionEnvironment,
      functionId: telemetryId,
    },
  });
}
