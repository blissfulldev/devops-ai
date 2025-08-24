import { streamText, generateObject, type UIMessageStreamWriter } from 'ai';
import { z } from 'zod';
import { myProvider } from '@/lib/ai/providers';
import { isProductionEnvironment } from '@/lib/constants';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { AgentRunner } from './types';
import { runDiagramAgent } from './diagrammer';
import { runTerraformAgent } from './terraform';
import { runCoreAgent } from './core';

import {
  AgentStatus,
  WorkflowPhase,
  type AgentName,
} from '../conversation-state';
import { EnhancedStateManager } from '../enhanced-conversation-state';
import type { Session } from 'next-auth';

// Import our refactored modules
import * as S from './enhanced-state-wrapper';
import * as StateReconciliation from './state-reconciliation';
import {
  stringifyError,
  getLastUserText,
  extractClarificationResponses,
  validateSupervisorParams,
  sanitizeChatId,
  calculateProcessingMetrics,
} from './supervisor-utils';

type RunSupervisorAgentParams = {
  selectedChatModel: ChatModel;
  uiMessages: ChatMessage[];
  session?: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  telemetryId?: string;
  chatId: string;
};

/**
 * Main supervisor agent function - orchestrates the entire workflow
 */
export function runSupervisorAgent({
  selectedChatModel,
  uiMessages,
  session,
  dataStream,
  telemetryId = 'supervisor-turn',
  chatId,
}: RunSupervisorAgentParams) {
  const startTime = Date.now();

  // Validate parameters
  const validation = validateSupervisorParams({
    selectedChatModel,
    uiMessages,
    dataStream,
    session,
  });

  if (!validation.isValid) {
    console.error('[Supervisor] Invalid parameters:', validation.errors);
    dataStream.write({
      type: 'error',
      errorText: `Invalid parameters: ${validation.errors.join(', ')}`,
    });
    return;
  }

  async function runTurn() {
    try {
      console.log(
        `[Supervisor] Starting turn for chat: ${sanitizeChatId(chatId)}`,
      );

      // Initialize enhanced state if needed
      if (session) {
        EnhancedStateManager.updateEnhancedState(
          chatId,
          () => {
            // Note: sessionId and userId are not part of the EnhancedConversationState interface
            // This would need to be added to the interface if needed
            console.log(
              'Session initialized for user:',
              session.user?.id || 'anonymous',
            );
          },
          'Initialized session information',
        );
      }

      // Perform comprehensive state reconciliation with error recovery
      const reconciliationResult =
        await StateReconciliation.performStateReconciliation(chatId);
      if (!reconciliationResult.success) {
        console.warn(
          '[Supervisor] State reconciliation had issues:',
          reconciliationResult.issuesFound,
        );
      }

      // Process any clarification responses from the UI messages
      const clarificationResponses = extractClarificationResponses(uiMessages);
      if (clarificationResponses.length > 0) {
        console.log(
          `[Supervisor] Processing ${clarificationResponses.length} clarification responses`,
        );

        for (const response of clarificationResponses) {
          S.addClarificationResponse(
            chatId,
            response,
            S.getState(chatId).currentAgent || 'core_agent',
          );
        }

        // Check if we can resume workflow
        reconcileAfterClarificationIfNeeded(chatId);
      }

      // Check if still waiting for clarifications
      const state = S.getState(chatId);
      if (state.isWaitingForClarification) {
        const pending = state.pendingClarifications;
        const pendingArray = Array.from(pending.values());
        const firstPending = pendingArray[0];
        const agentName =
          firstPending?.agentName || state.currentAgent || 'the previous agent';

        await pushGuidedNotice(
          selectedChatModel,
          dataStream,
          `Workflow is paused. ${agentName} requested ${pending.size} clarification(s).`,
          {
            type: 'waiting',
            agentName,
            pendingCount: pending.size,
            pendingClarifications: pendingArray,
          },
        );
        return;
      }

      // Check if workflow is completed
      if (state.workflowCompleted) {
        await handleCompletedWorkflow(
          selectedChatModel,
          uiMessages,
          dataStream,
          chatId,
          telemetryId,
        );
        return;
      }

      // Determine next agent to run
      const nextAgent = await determineNextAgent(chatId, selectedChatModel);
      if (!nextAgent) {
        await pushGuidedNotice(
          selectedChatModel,
          dataStream,
          'Workflow completed successfully!',
          { type: 'completion' },
        );
        S.setWorkflowCompleted(chatId, true);
        return;
      }

      // Update current agent and run it
      S.updateCurrentAgent(chatId, nextAgent);
      S.updateAgentStatus(chatId, nextAgent, AgentStatus.RUNNING);

      console.log(`[Supervisor] Running agent: ${nextAgent}`);

      await runAgentByName(nextAgent, {
        selectedChatModel,
        uiMessages,
        session,
        dataStream,
        telemetryId,
        chatId,
      });

      // Update agent status after completion
      S.updateAgentStatus(chatId, nextAgent, AgentStatus.COMPLETED);

      // Calculate and log metrics
      const metrics = calculateProcessingMetrics(startTime, uiMessages.length);
      console.log(`[Supervisor] Turn completed in ${metrics.processingTime}ms`);
    } catch (error) {
      console.error('[Supervisor] Error during turn:', stringifyError(error));

      // Attempt state recovery
      try {
        await StateReconciliation.performStateReconciliation(chatId, {
          forceReset: true,
        });
      } catch (recoveryError) {
        console.error(
          '[Supervisor] State recovery failed:',
          stringifyError(recoveryError),
        );
      }

      dataStream.write({
        type: 'error',
        errorText: `Supervisor error: ${stringifyError(error)}`,
      });
    }
  }

  return streamText({
    model: myProvider.languageModel(selectedChatModel.id),
    system: `You are the Supervisor Agent coordinating a multi-agent workflow.
    
Your role is to:
1. Orchestrate the workflow between core_agent, diagram_agent, and terraform_agent
2. Handle clarification requests and responses
3. Provide guidance to users about the current workflow state
4. Ensure smooth transitions between workflow phases

Current workflow phases:
- PLANNING: Core agent gathers requirements and creates project structure
- DESIGN: Diagram agent creates architecture diagrams
- IMPLEMENTATION: Terraform agent generates infrastructure code

Always provide clear, helpful guidance about what's happening and what the user should expect next.`,
    messages: uiMessages.map((m) => {
      const message = m as any;
      return {
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content || ''),
      };
    }),
    onFinish: async () => {
      await runTurn();
    },
    experimental_telemetry: {
      isEnabled: !isProductionEnvironment,
      functionId: telemetryId,
    },
  });
}

/**
 * Reconcile state after clarification responses
 */
function reconcileAfterClarificationIfNeeded(chatId: string): void {
  const state = S.getState(chatId);

  if (state.isWaitingForClarification && state.pendingClarifications.size > 0) {
    // Check if all pending clarifications have responses
    const pendingArray = Array.from(state.pendingClarifications.values());
    const responsesArray = Array.from(state.clarificationResponses || []);

    const hasAllResponses = pendingArray.every((clarification) => {
      return responsesArray.some(
        (response: any) => response.questionId === clarification.id,
      );
    });

    if (hasAllResponses) {
      console.log(
        '[Supervisor] All clarifications answered, resuming workflow',
      );
      S.setWaitingForClarification(chatId, false);

      // Clear pending clarifications
      EnhancedStateManager.updateEnhancedState(
        chatId,
        (state) => {
          state.pendingClarifications.clear();
        },
        'Cleared resolved clarifications',
      );
    }
  }
}

/**
 * Handle completed workflow state
 */
async function handleCompletedWorkflow(
  selectedChatModel: ChatModel,
  uiMessages: ChatMessage[],
  dataStream: UIMessageStreamWriter<ChatMessage>,
  chatId: string,
  telemetryId: string,
): Promise<void> {
  const lastUserText = getLastUserText(uiMessages);

  if (lastUserText.trim()) {
    // User has a new request, switch to adhoc mode
    console.log('[Supervisor] Switching to adhoc mode for new user request');

    S.updateWorkflowPhase(chatId, WorkflowPhase.PLANNING);
    S.setWorkflowCompleted(chatId, false);

    // Run core agent for the new request
    await runCoreAgent({
      selectedChatModel: selectedChatModel.id,
      uiMessages,
      input: lastUserText,
      session: {} as Session,
      dataStream,
      telemetryId,
      chatId,
    });
  } else {
    await pushGuidedNotice(
      selectedChatModel,
      dataStream,
      'Workflow completed! You can ask follow-up questions or start a new project.',
      { type: 'completion' },
    );
  }
}

/**
 * Determine the next agent to run based on workflow state
 */
async function determineNextAgent(
  chatId: string,
  selectedChatModel: ChatModel,
): Promise<AgentName | null> {
  const state = S.getState(chatId);

  // Use workflow orchestrator to determine next agent
  try {
    const recommendations = await S.getWorkflowRecommendations(
      chatId,
      selectedChatModel.id,
    );

    if (recommendations.nextAgent) {
      return recommendations.nextAgent as AgentName;
    }
  } catch (error) {
    console.warn('[Supervisor] Failed to get workflow recommendations:', error);
  }

  // Fallback logic based on current phase
  switch (state.workflowPhase) {
    case WorkflowPhase.PLANNING:
      return 'core_agent';
    case WorkflowPhase.DESIGN:
      return 'diagram_agent';
    case WorkflowPhase.IMPLEMENTATION:
      return 'terraform_agent';
    default:
      return null;
  }
}

/**
 * Run agent by name
 */
async function runAgentByName(
  agentName: AgentName,
  params: RunSupervisorAgentParams,
): Promise<void> {
  const agentRunners: Record<AgentName, AgentRunner> = {
    core_agent: runCoreAgent,
    diagram_agent: runDiagramAgent,
    terraform_agent: runTerraformAgent,
  };

  const runner = agentRunners[agentName];
  if (!runner) {
    throw new Error(`Unknown agent: ${agentName}`);
  }

  // Extract input from the last user message
  const lastUserText = getLastUserText(params.uiMessages);

  // Convert params to match AgentRunner interface
  const agentParams = {
    selectedChatModel: params.selectedChatModel.id,
    uiMessages: params.uiMessages,
    input: lastUserText,
    session: params.session || ({} as Session),
    dataStream: params.dataStream,
    telemetryId: params.telemetryId,
    chatId: params.chatId,
  };

  await runner(agentParams);
}

/**
 * Push guided notice to user with AI-generated content
 */
async function pushGuidedNotice(
  selectedChatModel: ChatModel,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  message: string,
  context: any,
): Promise<void> {
  try {
    // Generate enhanced guidance using AI
    const guidance = await generateObject({
      model: myProvider.languageModel(selectedChatModel.id),
      schema: z.object({
        message: z.string(),
        nextSteps: z.array(z.string()),
        estimatedTime: z.string().optional(),
        tips: z.array(z.string()).optional(),
      }),
      prompt: `Generate helpful guidance for this workflow situation:
      
      Base message: "${message}"
      Context: ${JSON.stringify(context)}
      
      Provide a clear, encouraging message with specific next steps the user should take.`,
      system:
        'You are a helpful workflow assistant. Provide clear, actionable guidance.',
    });

    // Write as a text message with structured data
    dataStream.write({
      type: 'data-appendMessage',
      data: `${guidance.object.message}\n\nNext steps:\n${guidance.object.nextSteps.map((step) => `• ${step}`).join('\n')}${guidance.object.estimatedTime ? `\n\nEstimated time: ${guidance.object.estimatedTime}` : ''}${guidance.object.tips ? `\n\nTips:\n${guidance.object.tips.map((tip) => `• ${tip}`).join('\n')}` : ''}`,
    });
  } catch (error) {
    console.warn(
      '[Supervisor] Failed to generate AI guidance, using fallback:',
      error,
    );

    dataStream.write({
      type: 'data-appendMessage',
      data: message,
    });
  }
}
