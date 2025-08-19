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

  // Run orchestration asynchronously so runSupervisorAgent can return a short acknowledgment stream
  (async () => {
    console.log(
      'Supervisor starting deterministic orchestration for chat:',
      chatId,
    );

    // Validate dataStream shape early (best-effort)
    if (!dataStream || typeof (dataStream as any).merge !== 'function') {
      console.warn(
        'Supervisor: dataStream.merge not available - UI merging may fail.',
      );
    }

    // If already waiting for clarification at start, notify and stop
    if (ConversationStateManager.isWaitingForClarification(chatId)) {
      const pending = ConversationStateManager.getPendingClarifications(chatId);
      console.log(
        'Supervisor paused at start - waiting for clarifications:',
        pending.length,
      );
      pushUiNotice(
        `Workflow is paused. Waiting for user to answer ${pending.length} clarification(s).`,
      );
      return;
    }

    // Iterate agents sequentially
    for (const agentName of AGENT_ORDER) {
      try {
        const state = (ConversationStateManager as any).getState(chatId) as any;
        const agentStatus = state.agentStates?.[agentName];

        // Skip if already completed
        if (agentStatus === AgentStatus.COMPLETED) {
          console.log(`Supervisor: skipping ${agentName} (already completed)`);
          continue;
        }

        console.log(
          `Supervisor: preparing to run agent ${agentName}. Current status: ${agentStatus}`,
        );

        // Mark current agent as running (this sets state.agentStates[agentName] = RUNNING)
        ConversationStateManager.setCurrentAgent(chatId, agentName);

        // Build augmented UI messages including safe normalization of clarification responses
        const rawClarResponses =
          ConversationStateManager.getAllClarificationResponses(chatId) || [];
        // Defensive filter to remove malformed entries
        const clarificationResponses = rawClarResponses.filter(
          Boolean,
        ) as any[];

        const augmentedUIMessages: ChatMessage[] = [
          ...uiMessages,
          ...(clarificationResponses
            .filter(Boolean)
            .map((r) => {
              if (!r || typeof r !== 'object') {
                console.warn(
                  'Supervisor: encountered malformed clarification response for chat',
                  chatId,
                  r,
                );
                return null;
              }
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

        // Record pending-before to detect whether the child creates clarifications itself
        const pendingBefore =
          ConversationStateManager.getPendingClarifications(chatId).length;

        // Runner creation: defensive checks and one retry
        let child: ReturnType<AgentRunner>;
        try {
          const runnerFn = agents[agentName];
          if (typeof runnerFn !== 'function') {
            console.error(
              `Supervisor: runner for ${agentName} is not a function`,
              runnerFn,
            );
            pushUiNotice(
              `Internal error: agent "${agentName}" is not available. Check server logs.`,
            );
            // mark failed and stop
            try {
              const s = (ConversationStateManager as any).getState(
                chatId,
              ) as any;
              if (s.agentStates && agentName in s.agentStates) {
                s.agentStates[agentName] = AgentStatus.FAILED;
              }
            } catch (mErr) {
              console.error(
                'Supervisor: error marking agent failed:',
                stringifyError(mErr),
              );
            }
            return;
          }

          // Call runner (capture synchronous throws)
          try {
            child = runnerFn({
              selectedChatModel,
              uiMessages: augmentedUIMessages,
              input: '',
              dataStream,
              telemetryId: `agent-${agentName}`,
              chatId,
            });
          } catch (callErr) {
            console.error(
              `Supervisor: runner function threw synchronously for ${agentName}:`,
              stringifyError(callErr),
            );
            pushUiNotice(
              `Agent ${agentName} failed to start: ${stringifyError(callErr)}`,
            );
            // mark failed and stop
            try {
              const s = (ConversationStateManager as any).getState(
                chatId,
              ) as any;
              if (s.agentStates && agentName in s.agentStates) {
                s.agentStates[agentName] = AgentStatus.FAILED;
              }
            } catch (mErr) {
              console.error(
                'Supervisor: error marking agent failed after sync throw:',
                stringifyError(mErr),
              );
            }
            return;
          }
        } catch (err) {
          console.error(
            `Supervisor: unexpected error preparing runner for ${agentName}:`,
            stringifyError(err),
          );
          pushUiNotice(
            `Internal error preparing agent ${agentName}. Check server logs.`,
          );
          try {
            const s = (ConversationStateManager as any).getState(chatId) as any;
            if (s.agentStates && agentName in s.agentStates) {
              s.agentStates[agentName] = AgentStatus.FAILED;
            }
          } catch (mErr) {
            console.error(
              'Supervisor: error marking agent failed after unexpected error:',
              stringifyError(mErr),
            );
          }
          return;
        }

        // Merge child's UI stream into supervisor's data stream
        try {
          dataStream.merge(child.toUIMessageStream({ sendReasoning: true }));
        } catch (err) {
          console.error(
            `Supervisor: error merging ${agentName} child stream:`,
            stringifyError(err),
          );
        }

        // Await child completion so notifier won't interleave with child tokens
        try {
          await child.consumeStream();
        } catch (err) {
          console.error(
            `Supervisor: child ${agentName} consumeStream threw:`,
            stringifyError(err),
          );
          // Clear current agent and mark failed
          ConversationStateManager.clearCurrentAgent(chatId);
          try {
            const s = (ConversationStateManager as any).getState(chatId) as any;
            if (s.agentStates && agentName in s.agentStates) {
              s.agentStates[agentName] = AgentStatus.FAILED;
            }
          } catch (mErr) {
            console.error(
              'Supervisor: error marking agent failed after stream error:',
              stringifyError(mErr),
            );
          }
          pushUiNotice(
            `Agent ${agentName} encountered an error during execution.`,
          );
          return;
        }

        // Small pause to allow streaming infra to flush
        await sleep(80);

        // After child finishes: check clarifications (use pendingBefore to avoid double notifications)
        const pendingAfter =
          ConversationStateManager.getPendingClarifications(chatId).length;
        const waiting =
          ConversationStateManager.isWaitingForClarification(chatId);

        if (waiting && pendingAfter > 0) {
          if (pendingAfter > pendingBefore) {
            console.log(
              `Supervisor: child ${agentName} created ${pendingAfter - pendingBefore} clarification(s). Skipping supervisor notice.`,
            );
            // Keep agent in WAITING_FOR_CLARIFICATION state (already set by requestClarification tool)
            return;
          }

          console.log(
            `Supervisor: agent ${agentName} requested clarifications. Pausing orchestration.`,
          );
          pushUiNotice(
            `Agent ${agentName} has asked for ${pendingAfter} clarification(s). Workflow is paused until the user answers.`,
          );
          return;
        }

        // If agent didn't explicitly mark itself completed, mark it completed now
        const progress = ConversationStateManager.getWorkflowProgress(chatId);
        if (!progress.completedAgents.includes(agentName)) {
          console.log(`Supervisor: auto-marking ${agentName} as completed.`);
          ConversationStateManager.markAgentCompleted(chatId, agentName);
        }

        // Clear currentAgent to allow next agent to start
        ConversationStateManager.clearCurrentAgent(chatId);
      } catch (err) {
        console.error(
          `Supervisor: unexpected error while running ${agentName}:`,
          stringifyError(err),
        );
        try {
          const s = (ConversationStateManager as any).getState(chatId) as any;
          if (s.agentStates && agentName in s.agentStates) {
            s.agentStates[agentName] = AgentStatus.FAILED;
          }
        } catch (mErr) {
          console.error(
            'Supervisor: error marking agent failed after unexpected error:',
            stringifyError(mErr),
          );
        }
        pushUiNotice(
          `Agent ${agentName} failed unexpectedly: ${stringifyError(err)}`,
        );
        return;
      }
    }

    // All agents run (or were marked completed); mark workflow complete
    console.log(
      'Supervisor: all agents completed (or marked completed). Marking workflow complete.',
    );
    try {
      const s = (ConversationStateManager as any).getState(chatId) as any;
      s.workflowPhase =
        (ConversationStateManager as any).WorkflowPhase?.COMPLETED ??
        'completed';
    } catch (err) {
      console.error(
        'Supervisor: error setting workflow phase to COMPLETED:',
        stringifyError(err),
      );
    }
    pushUiNotice(
      'Workflow completed: core_agent, diagram_agent, terraform_agent have run successfully.',
    );
  })().catch((err) => {
    console.error(
      'Supervisor orchestration top-level error:',
      stringifyError(err),
    );
  });

  // Return a short acknowledgment stream
  return streamText({
    model: myProvider.languageModel(selectedChatModel),
    system: supervisorSystemPrompt,
    messages: [
      {
        role: 'user',
        content:
          'Supervisor has started deterministic orchestration. Streaming outputs from agents will appear shortly.',
      },
    ],
    stopWhen: stepCountIs(1),
    experimental_transform: smoothStream({ chunking: 'word' }),
    experimental_telemetry: {
      isEnabled: isProductionEnvironment,
      functionId: telemetryId,
    },
  });
}
