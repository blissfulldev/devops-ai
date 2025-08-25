import type { UIMessageStreamWriter } from 'ai';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { AgentRunner } from './types';
import { runDiagramAgent } from './diagrammer';
import { runTerraformAgent } from './terraform';
import { runCoreAgent } from './core';
import { ConversationStateManager, AgentStatus } from '../conversation-state';
import type { Session } from 'next-auth';
import type { AgentWorkflowState } from '../conversation-state';
import {
  stringifyError,
  sleep,
  notifyUI,
  buildAugmentedUIMessages,
} from './utils';

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
  // Supervisor orchestrator class (explicitly receives session)
  class SupervisorOrchestrator {
    constructor(
      private selectedChatModel: ChatModel['id'],
      private uiMessages: ChatMessage[],
      private dataStream: UIMessageStreamWriter<ChatMessage>,
      private chatId: string,
      private session: Session,
      private telemetryId: string,
    ) {}

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

    async runOrchestration() {
      this.log('Starting supervisor orchestration for chat', this.chatId);

      // If already waiting, notify and return
      if (ConversationStateManager.isWaitingForClarification(this.chatId)) {
        const pending = ConversationStateManager.getPendingClarifications(
          this.chatId,
        );
        this.pushUiNotice(
          `Workflow is paused. Waiting for user to answer ${pending.length} clarification(s).`,
        );
        return;
      }

      // Determine start index: resume from pausedAgent if present, else first non-completed agent
      let startIndex = 0;
      const paused = ConversationStateManager.getPausedAgent(this.chatId);
      if (paused) {
        const idx = AGENT_ORDER.indexOf(paused as AgentName);
        startIndex = idx >= 0 ? idx : 0;
        this.log(
          'Resuming from pausedAgent:',
          paused,
          'startIndex:',
          startIndex,
        );
      } else {
        const progress = ConversationStateManager.getWorkflowProgress(
          this.chatId,
        );
        for (let i = 0; i < AGENT_ORDER.length; i++) {
          if (!progress.completedAgents.includes(AGENT_ORDER[i])) {
            startIndex = i;
            break;
          }
        }
        this.log(
          'No pausedAgent; starting from first non-completed index:',
          startIndex,
        );
      }

      for (let i = startIndex; i < AGENT_ORDER.length; i++) {
        const agentName = AGENT_ORDER[i];

        // Read canonical state
        const state = ConversationStateManager.getState(this.chatId);
        const agentStatus =
          state.agentStates[agentName as keyof AgentWorkflowState];

        // If agent is already running, skip to avoid parallel start
        if (agentStatus === AgentStatus.RUNNING) {
          this.log(
            `Skipping ${agentName} because it's already RUNNING (prevent parallel start)`,
          );
          continue;
        }

        // If agent is waiting for clarification, only resume if this is the pausedAgent and waiting is cleared
        if (agentStatus === AgentStatus.WAITING_FOR_CLARIFICATION) {
          const pausedAgent = ConversationStateManager.getPausedAgent(
            this.chatId,
          );
          const stillWaiting =
            ConversationStateManager.isWaitingForClarification(this.chatId);
          if (pausedAgent === agentName && !stillWaiting) {
            this.log(
              `Resuming ${agentName} after clarifications as pausedAgent`,
            );
          } else {
            this.log(
              `Not resuming ${agentName}. pausedAgent=${pausedAgent}, stillWaiting=${stillWaiting}`,
            );
            continue;
          }
        }

        if (this.isAgentCompleted(agentName)) {
          this.log(`Skipping ${agentName} (already completed)`);
          continue;
        }

        // OK to start/resume: update currentAgent -> this marks agent RUNNING
        ConversationStateManager.setCurrentAgent(this.chatId, agentName);

        this.log(`Running agent: ${agentName}`);
        const augmentedUIMessages = this.buildAugmentedUIMessages();

        let child: ReturnType<AgentRunner>;
        try {
          child = this.runAgent(agentName, augmentedUIMessages);
        } catch (err) {
          this.pushUiNotice(
            `Agent ${agentName} failed to start: ${stringifyError(err)}`,
          );
          // mark failed via updateState
          try {
            ConversationStateManager.updateState(this.chatId, (s) => {
              if ((agentName as keyof AgentWorkflowState) in s.agentStates) {
                s.agentStates[agentName as keyof AgentWorkflowState] =
                  AgentStatus.FAILED;
              }
            });
          } catch (mErr) {
            console.error('Error marking agent failed:', stringifyError(mErr));
          }
          // ensure currentAgent cleared so supervisor can retry later
          ConversationStateManager.clearCurrentAgent(this.chatId);
          continue;
        }

        // Merge child stream (safe-guard)
        try {
          this.dataStream.merge(
            child.toUIMessageStream({ sendReasoning: true }),
          );
        } catch (err) {
          console.error(
            `Supervisor: error merging ${agentName} child stream:`,
            stringifyError(err),
          );
        }

        // Await child completion or pause due to clarifications
        try {
          await child.consumeStream();
        } catch (err) {
          this.pushUiNotice(
            `Agent ${agentName} encountered an error during execution.`,
          );
          try {
            ConversationStateManager.updateState(this.chatId, (s) => {
              if ((agentName as keyof AgentWorkflowState) in s.agentStates) {
                s.agentStates[agentName as keyof AgentWorkflowState] =
                  AgentStatus.FAILED;
              }
            });
          } catch (mErr) {
            console.error(
              'Error marking agent failed after stream error:',
              stringifyError(mErr),
            );
          }
          ConversationStateManager.clearCurrentAgent(this.chatId);
          return;
        }

        // Small pause to allow streaming infra to flush
        await sleep(80);

        // If child requested clarifications (state updated by requestClarification), pause orchestration
        if (this.handleClarificationPause(agentName)) {
          this.log('Paused and recorded pausedAgent:', agentName);
          return;
        }

        // Mark agent completed if not already
        this.markAgentCompleted(agentName);

        // If this agent equals pausedAgent (corner case), clear pausedAgent now that it's done
        const currentPaused = ConversationStateManager.getPausedAgent(
          this.chatId,
        );
        if (currentPaused === agentName) {
          ConversationStateManager.clearPausedAgent(this.chatId);
        }

        ConversationStateManager.clearCurrentAgent(this.chatId);
      }

      // All agents done -> mark workflow completed
      this.markWorkflowCompleted();
      // this.pushUiNotice(
      //   'Workflow completed: core_agent, diagram_agent, terraform_agent have run successfully.',
      // );
    }

    buildAugmentedUIMessages(): ChatMessage[] {
      return buildAugmentedUIMessages({
        chatId: this.chatId,
        uiMessages: this.uiMessages,
      });
    }

    runAgent(
      agentName: AgentName,
      augmentedUIMessages: ChatMessage[],
    ): ReturnType<AgentRunner> {
      const runnerFn = agents[agentName];
      if (typeof runnerFn !== 'function') {
        throw new Error(`Runner not available for ${agentName}`);
      }
      return runnerFn({
        selectedChatModel: this.selectedChatModel,
        uiMessages: augmentedUIMessages,
        input: '',
        session: this.session,
        dataStream: this.dataStream,
        telemetryId: `agent-${agentName}`,
        chatId: this.chatId,
      });
    }

    isAgentCompleted(agentName: AgentName): boolean {
      const s = ConversationStateManager.getState(this.chatId);
      return s.agentStates?.[agentName] === AgentStatus.COMPLETED;
    }

    handleClarificationPause(agentName: AgentName): boolean {
      const pendingAfter = ConversationStateManager.getPendingClarifications(
        this.chatId,
      ).length;
      const waiting = ConversationStateManager.isWaitingForClarification(
        this.chatId,
      );
      if (waiting && pendingAfter > 0) {
        // Ensure pausedAgent is set (idempotent)
        ConversationStateManager.setPausedAgent(this.chatId, agentName);
        return true;
      }
      return false;
    }

    markAgentCompleted(agentName: AgentName) {
      const progress = ConversationStateManager.getWorkflowProgress(
        this.chatId,
      );
      if (!progress.completedAgents.includes(agentName)) {
        ConversationStateManager.markAgentCompleted(this.chatId, agentName);
      }
    }

    markWorkflowCompleted() {
      this.log('Workflow marked as completed.');
      try {
        ConversationStateManager.updateState(this.chatId, (s) => {
          s.workflowPhase = 'completed' as any;
        });
      } catch (err) {
        console.error(
          'Error setting workflow to completed:',
          stringifyError(err),
        );
      }
    }

    pushUiNotice(text: string) {
      notifyUI({
        text,
        selectedChatModel: this.selectedChatModel,
        dataStream: this.dataStream,
        telemetryId: this.telemetryId,
      });
    }

    log(...args: any[]) {
      console.log('[Supervisor]', ...args);
    }
  }

  // Instantiate and return composite stream (pass session)
  const orchestrator = new SupervisorOrchestrator(
    selectedChatModel,
    uiMessages,
    dataStream,
    chatId,
    session,
    telemetryId,
  );
  return {
    toUIMessageStream: () => orchestrator.toUIMessageStream(),
  };
}
