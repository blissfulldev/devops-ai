import {
  streamText,
  stepCountIs,
  smoothStream,
  type UIMessageStreamWriter,
  type UIMessagePart,
} from 'ai';
import { myProvider } from '@/lib/ai/providers';
import type {
  CustomUIDataTypes,
  ChatTools,
  ClarificationResponse,
} from '@/lib/types';
import { isProductionEnvironment } from '@/lib/constants';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { AgentRunner } from './types';
import { runDiagramAgent } from './diagrammer';
import { runTerraformAgent } from './terraform';
import { runCoreAgent } from './core';
import { ConversationStateManager, AgentStatus } from '../conversation-state';
import type { Session } from 'next-auth';
import { supervisorSystemPrompt } from './system-prompts';

type RunSupervisorAgentParams = {
  selectedChatModel: ChatModel['id'];
  uiMessages: ChatMessage[];
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  telemetryId?: string;
  chatId: string;
};

// Deterministic order
const AGENT_ORDER = ['core_agent', 'diagram_agent', 'terraform_agent'] as const;
type AgentName = (typeof AGENT_ORDER)[number];

const agents: Record<AgentName, AgentRunner> = {
  core_agent: runCoreAgent,
  diagram_agent: runDiagramAgent,
  terraform_agent: runTerraformAgent,
};

export function runSupervisorAgent({
  selectedChatModel,
  uiMessages,
  session,
  dataStream,
  telemetryId = 'supervisor-orchestrator',
  chatId,
}: RunSupervisorAgentParams) {
  // Helper: normalize clarification response text from different shapes
  function getClarificationAnswer(resp: ClarificationResponse | any): string {
    if (!resp) return '[No answer provided]';
    return (
      resp.answer ??
      resp.response ??
      resp.text ??
      resp.value ??
      resp.answerText ??
      '[No answer provided]'
    );
  }

  // Helper: small sleep to allow streams to flush and avoid token interleaving
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  // Helper: stringify unknown errors safely
  function stringifyError(err: unknown): string {
    if (err instanceof Error) {
      // prefer stack for richer context, fall back to message
      return err.stack ?? err.message ?? String(err);
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  // Helper: push a deterministic UI notice by creating a tiny 1-step notifier stream
  // This merges the notifier's assistant message into dataStream without calling non-existent methods.
  function pushUiNotice(text: string) {
    try {
      const notifier = streamText({
        model: myProvider.languageModel(selectedChatModel),
        system:
          'SYSTEM NOTE: You are a notifier. Reply with exactly the content given in the user message as a single assistant message and do NOT call any tools or add commentary.',
        messages: [{ role: 'user', content: text }],
        stopWhen: stepCountIs(1),
        experimental_transform: smoothStream({ chunking: 'word' }),
        experimental_telemetry: {
          isEnabled: isProductionEnvironment,
          functionId: telemetryId
            ? `${telemetryId}-notifier`
            : 'supervisor-notifier',
        },
      });

      try {
        dataStream.merge(notifier.toUIMessageStream({ sendReasoning: false }));
      } catch (err) {
        console.error(
          'Error merging notifier stream into dataStream:',
          stringifyError(err),
        );
      }

      // Start consumption (fire-and-forget)
      notifier.consumeStream().catch((err) => {
        console.error('Notifier stream error:', stringifyError(err));
      });
    } catch (err) {
      console.error(
        'Failed to push UI notice via notifier stream:',
        stringifyError(err),
      );
    }
  }

  // Run orchestration synchronously and stream all agent outputs to the UI
  // --- SupervisorOrchestrator: orchestrates agent workflow and streaming ---
  class SupervisorOrchestrator {
    constructor(
      private selectedChatModel: ChatModel['id'],
      private uiMessages: ChatMessage[],
      private dataStream: UIMessageStreamWriter<ChatMessage>,
      private chatId: string,
    ) {}

    // Main entry: returns composite stream for UI
    toUIMessageStream() {
      const compositeStream = {
        merge: (childStream: any) => {
          if (typeof this.dataStream.merge === 'function') {
            this.dataStream.merge(childStream);
          }
        },
        consumeStream: async () => {
          await this.runOrchestration();
        },
      };
      return compositeStream;
    }

    // Orchestration logic: runs agents sequentially, handles clarifications/errors
    async runOrchestration() {
      this.log('Starting supervisor orchestration');
      if (ConversationStateManager.isWaitingForClarification(this.chatId)) {
        const pending = ConversationStateManager.getPendingClarifications(
          this.chatId,
        );
        this.pushUiNotice(
          `Workflow is paused. Waiting for user to answer ${pending.length} clarification(s).`,
        );
        return;
      }
      for (const agentName of AGENT_ORDER) {
        if (this.isAgentCompleted(agentName)) {
          this.log(`Skipping ${agentName} (already completed)`);
          continue;
        }
        this.log(`Running agent: ${agentName}`);
        ConversationStateManager.setCurrentAgent(this.chatId, agentName);
        const augmentedUIMessages = this.buildAugmentedUIMessages();
        let child: ReturnType<AgentRunner>;
        try {
          child = this.runAgent(agentName, augmentedUIMessages);
        } catch (err) {
          this.pushUiNotice(
            `Agent ${agentName} failed to start: ${stringifyError(err)}`,
          );
          continue;
        }
        try {
          this.dataStream.merge(
            child.toUIMessageStream({ sendReasoning: true }),
          );
          await child.consumeStream();
        } catch (err) {
          this.pushUiNotice(
            `Agent ${agentName} encountered an error during execution.`,
          );
          continue;
        }
        await sleep(80);
        if (this.handleClarificationPause(agentName)) return;
        this.markAgentCompleted(agentName);
        ConversationStateManager.clearCurrentAgent(this.chatId);
      }
      this.markWorkflowCompleted();
      this.pushUiNotice(
        'Workflow completed: core_agent, diagram_agent, terraform_agent have run successfully.',
      );
    }

    // Helper: build augmented UI messages with clarifications
    buildAugmentedUIMessages(): ChatMessage[] {
      const rawClarResponses =
        ConversationStateManager.getAllClarificationResponses(this.chatId) ||
        [];
      const clarificationResponses = rawClarResponses.filter(Boolean) as any[];
      return [
        ...this.uiMessages,
        ...(clarificationResponses
          .filter(Boolean)
          .map((r) => {
            if (!r || typeof r !== 'object') return null;
            const answerText = getClarificationAnswer(r);
            return {
              id: r.id ?? `clar-${Math.random().toString(36).slice(2)}`,
              role: 'user' as const,
              parts: [
                {
                  type: 'text',
                  text: `Clarification response: ${answerText}`,
                } as UIMessagePart<CustomUIDataTypes, ChatTools>,
              ],
              metadata: {
                createdAt: (r.timestamp as string) ?? new Date().toISOString(),
              },
            } as ChatMessage;
          })
          .filter(Boolean) as ChatMessage[]),
      ];
    }

    // Helper: run agent and return child stream
    runAgent(
      agentName: AgentName,
      augmentedUIMessages: ChatMessage[],
    ): ReturnType<AgentRunner> {
      const runnerFn = agents[agentName];
      return runnerFn({
        selectedChatModel: this.selectedChatModel,
        uiMessages: augmentedUIMessages,
        input: '',
        dataStream: this.dataStream,
        telemetryId: `agent-${agentName}`,
        chatId: this.chatId,
      });
    }

    // Helper: check if agent is completed
    isAgentCompleted(agentName: AgentName): boolean {
      const state = (ConversationStateManager as any).getState(
        this.chatId,
      ) as any;
      return state.agentStates?.[agentName] === AgentStatus.COMPLETED;
    }

    // Helper: handle clarification pause
    handleClarificationPause(agentName: AgentName): boolean {
      const pendingAfter = ConversationStateManager.getPendingClarifications(
        this.chatId,
      ).length;
      const waiting = ConversationStateManager.isWaitingForClarification(
        this.chatId,
      );
      if (waiting && pendingAfter > 0) {
        this.pushUiNotice(
          `Agent ${agentName} has asked for ${pendingAfter} clarification(s). Workflow is paused until the user answers.`,
        );
        return true;
      }
      return false;
    }

    // Helper: mark agent as completed
    markAgentCompleted(agentName: AgentName) {
      const progress = ConversationStateManager.getWorkflowProgress(
        this.chatId,
      );
      if (!progress.completedAgents.includes(agentName)) {
        ConversationStateManager.markAgentCompleted(this.chatId, agentName);
      }
    }

    // Helper: mark workflow as completed
    markWorkflowCompleted() {
      try {
        const s = (ConversationStateManager as any).getState(
          this.chatId,
        ) as any;
        s.workflowPhase =
          (ConversationStateManager as any).WorkflowPhase?.COMPLETED ??
          'completed';
      } catch (err) {}
    }

    // Helper: push UI notice
    pushUiNotice(text: string) {
      pushUiNotice(text);
    }

    // Helper: verbose logging
    log(...args: any[]) {
      console.log('[Supervisor]', ...args);
    }
  }

  // Return orchestrator composite stream
  const orchestrator = new SupervisorOrchestrator(
    selectedChatModel,
    uiMessages,
    dataStream,
    chatId,
  );
  return {
    toUIMessageStream: () => orchestrator.toUIMessageStream(),
  };
}
