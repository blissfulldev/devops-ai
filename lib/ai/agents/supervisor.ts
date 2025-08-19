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
  return {
    toUIMessageStream: () => {
      // Create a composite stream that merges all agent outputs
      const compositeStream = {
        merge: (childStream: any) => {
          if (typeof dataStream.merge === 'function') {
            dataStream.merge(childStream);
          }
        },
        consumeStream: async () => {
          // Supervisor orchestration logic
          if (ConversationStateManager.isWaitingForClarification(chatId)) {
            const pending =
              ConversationStateManager.getPendingClarifications(chatId);
            pushUiNotice(
              `Workflow is paused. Waiting for user to answer ${pending.length} clarification(s).`,
            );
            return;
          }
          for (const agentName of AGENT_ORDER) {
            try {
              const state = (ConversationStateManager as any).getState(
                chatId,
              ) as any;
              const agentStatus = state.agentStates?.[agentName];
              if (agentStatus === AgentStatus.COMPLETED) continue;
              ConversationStateManager.setCurrentAgent(chatId, agentName);
              const rawClarResponses =
                ConversationStateManager.getAllClarificationResponses(chatId) ||
                [];
              const clarificationResponses = rawClarResponses.filter(
                Boolean,
              ) as any[];
              const augmentedUIMessages: ChatMessage[] = [
                ...uiMessages,
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
                        createdAt:
                          (r.timestamp as string) ?? new Date().toISOString(),
                      },
                    } as ChatMessage;
                  })
                  .filter(Boolean) as ChatMessage[]),
              ];
              let child: ReturnType<AgentRunner>;
              try {
                const runnerFn = agents[agentName];
                child = runnerFn({
                  selectedChatModel,
                  uiMessages: augmentedUIMessages,
                  input: '',
                  dataStream,
                  telemetryId: `agent-${agentName}`,
                  chatId,
                });
              } catch (err) {
                pushUiNotice(
                  `Agent ${agentName} failed to start: ${stringifyError(err)}`,
                );
                continue;
              }
              try {
                dataStream.merge(
                  child.toUIMessageStream({ sendReasoning: true }),
                );
                await child.consumeStream();
              } catch (err) {
                pushUiNotice(
                  `Agent ${agentName} encountered an error during execution.`,
                );
                continue;
              }
              await sleep(80);
              const pendingAfter =
                ConversationStateManager.getPendingClarifications(
                  chatId,
                ).length;
              const waiting =
                ConversationStateManager.isWaitingForClarification(chatId);
              if (waiting && pendingAfter > 0) {
                pushUiNotice(
                  `Agent ${agentName} has asked for ${pendingAfter} clarification(s). Workflow is paused until the user answers.`,
                );
                return;
              }
              const progress =
                ConversationStateManager.getWorkflowProgress(chatId);
              if (!progress.completedAgents.includes(agentName)) {
                ConversationStateManager.markAgentCompleted(chatId, agentName);
              }
              ConversationStateManager.clearCurrentAgent(chatId);
            } catch (err) {
              pushUiNotice(
                `Agent ${agentName} failed unexpectedly: ${stringifyError(err)}`,
              );
              continue;
            }
          }
          try {
            const s = (ConversationStateManager as any).getState(chatId) as any;
            s.workflowPhase =
              (ConversationStateManager as any).WorkflowPhase?.COMPLETED ??
              'completed';
          } catch (err) {}
          pushUiNotice(
            'Workflow completed: core_agent, diagram_agent, terraform_agent have run successfully.',
          );
        },
      };
      return compositeStream;
    },
  };
}
