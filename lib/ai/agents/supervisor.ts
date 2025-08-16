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
import type { RequestHints } from '@/lib/ai/prompts';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { AgentRunner } from './types';
import { runDiagramAgent } from './diagrammer';
import { runTerraformAgent } from './terraform';
import { runCoreAgent } from './core';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { requestClarification } from '@/lib/ai/tools/request-clarification';
import { ConversationStateManager } from '@/lib/ai/conversation-state';
import type { Session } from 'next-auth';
import { supervisorSystemPrompt } from './system-prompts';

type RunSupervisorAgentParams = {
  selectedChatModel: ChatModel['id'];
  uiMessages: ChatMessage[];
  requestHints: RequestHints;
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
  requestHints,
  session,
  dataStream,
  telemetryId = 'supervisor-stream-text',
  chatId,
}: RunSupervisorAgentParams) {
  // Check if we're waiting for clarification before proceeding
  const isWaiting = ConversationStateManager.isWaitingForClarification(chatId);
  if (isWaiting) {
    const pendingClarifications =
      ConversationStateManager.getPendingClarifications(chatId);
    dataStream.write({
      type: 'data-appendMessage',
      data: `⏸️ Workflow paused. Waiting for clarification on ${pendingClarifications.length} question(s).`,
      transient: true,
    });
  }

  const delegate = tool({
    description: `Delegate a subtask to a specialized agent. Available agents:
    - diagram_agent: This allows you to generate AWS diagrams, sequence diagrams, flow diagrams, and class diagrams using Python code.
    - terraform_agent: For Terraform on AWS best practices, infrastructure as code patterns, and security compliance with Checkov.
    - core_agent: Planning and orchestration
            Provides tool for prompt understanding and translation to AWS services`,
    inputSchema: z.object({
      agent: z.enum(['diagram_agent', 'terraform_agent', 'core_agent']),
      input: z.string().describe('Task to pass to the agent'),
    }),
    execute: async ({ agent, input }) => {
      // Check if we should wait for clarification before delegating
      if (ConversationStateManager.isWaitingForClarification(chatId)) {
        return `Cannot delegate to ${agent} - waiting for user clarification. Please wait for user response before proceeding.`;
      }

      const runner = agents[agent as keyof typeof agents];
      if (!runner) return `Unknown agent: ${agent}`;

      // Set current agent in state
      ConversationStateManager.setCurrentAgent(chatId, agent);

      const child = runner({
        selectedChatModel,
        uiMessages,
        input,
        session,
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
    messages: convertToModelMessages(uiMessages),
    stopWhen: stepCountIs(8),
    experimental_transform: smoothStream({ chunking: 'word' }),
    tools: {
      delegate,
      // Optionally allow supervisor to use base tools directly too:
      createDocument: createDocument({ session, dataStream }),
      updateDocument: updateDocument({ session, dataStream }),
      requestSuggestions: requestSuggestions({ session, dataStream }),
      requestClarification: requestClarification({
        session,
        dataStream,
        agentName: 'supervisor',
      }),
    },
    experimental_telemetry: {
      isEnabled: isProductionEnvironment,
      functionId: telemetryId,
    },
  });
}
