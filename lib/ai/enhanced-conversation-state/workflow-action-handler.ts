import { generateObject, tool } from 'ai';
import { z } from 'zod';
import type { UIMessageStreamWriter } from 'ai/rsc';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import { myProvider } from '@/lib/ai/providers';
import type { AgentName } from '../conversation-state';
import type {
  EnhancedConversationState,
  WorkflowAction,
  UserAction,
  StepStatus,
  WorkflowPhase,
} from './types';
import type { EnhancedStateManager } from './enhanced-state-manager';

/**
 * WorkflowActionHandler manages the execution of workflow actions
 * and handles state transitions with comprehensive logic
 */
export class WorkflowActionHandler {
  private stateManager: EnhancedStateManager;

  constructor(stateManager: EnhancedStateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Determines the next action based on comprehensive workflow analysis
   */
  async determineNextAction(
    chatId: string,
    modelId: ChatModel['id'],
  ): Promise<WorkflowAction> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const analysis = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        recommendedAction: z.enum([
          'continue_agent',
          'advance_to_next',
          'wait_for_input',
          'complete_workflow',
        ]),
        agentName: z.string().optional(),
        confidence: z.number().min(0).max(1),
        reasoning: z.string(),
        userNotification: z.string(),
        autoExecute: z.boolean(),
        estimatedDuration: z.string().optional(),
        prerequisites: z.array(z.string()),
        potentialIssues: z.array(z.string()),
      }),
      prompt: `Analyze the current workflow state and determine the optimal next action:

Current State Analysis:
- Phase: ${state.currentPhase || 'unknown'}
- Current Agent: ${state.currentAgent || 'none'}
- Agent States: ${JSON.stringify(state.agentStates || {})}
- Pending Clarifications: ${state.pendingClarifications?.length || 0}
- Workflow Completed: ${state.workflowCompleted || false}

Progress Analysis:
- Completed Steps: ${state.workflowSteps?.filter((s) => s.status === 'completed').length || 0}
- Total Steps: ${state.workflowSteps?.length || 0}
- Active Steps: ${state.workflowSteps?.filter((s) => s.status === 'active').length || 0}
- Failed Steps: ${state.workflowSteps?.filter((s) => s.status === 'failed').length || 0}

Current Step Details:
${
  state.workflowSteps
    ?.map(
      (step, i) =>
        `${i + 1}. ${step.name} (${step.status}) - Agent: ${step.agentName}, Required Input: ${step.userInputRequired}`,
    )
    .join('\n') || 'No steps defined'
}

User Preferences:
- Auto-advance: ${state.userPreferences?.autoAdvancePreference || 'ask'}
- Verbosity: ${state.userPreferences?.verbosityLevel || 'normal'}
- Skip Optional: ${state.userPreferences?.skipOptionalSteps || false}

Recent Performance:
- Error Count: ${state.performanceMetrics?.errorCount || 0}
- Questions Reused: ${state.performanceMetrics?.questionsReused || 0}

Decision Criteria:
1. Are all clarifications for the current agent resolved?
2. Has the current agent completed successfully?
3. Are there any blocking dependencies?
4. Is user input required for the next step?
5. Should the workflow auto-advance based on user preferences?
6. Are there any error conditions that need attention?

Provide:
- Clear recommendation with high confidence reasoning
- Specific agent name if action involves agent execution
- User notification explaining what will happen
- Whether this action can be auto-executed
- Prerequisites that must be met
- Potential issues to watch for`,
      system: `You are an expert workflow orchestrator with deep understanding of agent-based systems.
      Make intelligent decisions that balance automation with user control.
      Consider error conditions, dependencies, and user preferences in your analysis.`,
    });

    return {
      type: analysis.object.recommendedAction,
      agentName: analysis.object.agentName as AgentName,
      reason: analysis.object.reasoning,
      userNotification: analysis.object.userNotification,
      autoExecute: analysis.object.autoExecute,
      confidence: analysis.object.confidence,
      estimatedDuration: analysis.object.estimatedDuration,
    };
  }

  /**
   * Execute a specific workflow action with comprehensive error handling
   */
  async executeWorkflowAction(
    chatId: string,
    action: WorkflowAction,
    modelId: ChatModel['id'],
    dataStream?: UIMessageStreamWriter<ChatMessage>,
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
    followUpActions?: WorkflowAction[];
  }> {
    try {
      const state = await this.stateManager.getState(chatId);
      if (!state) {
        throw new Error(`No state found for chat ${chatId}`);
      }

      let result: {
        success: boolean;
        message: string;
        newState?: Partial<EnhancedConversationState>;
      };

      switch (action.type) {
        case 'continue_agent':
          result = await this.executeContinueAgent(
            chatId,
            action.agentName || 'core_agent',
            modelId,
          );
          break;
        case 'advance_to_next':
          result = await this.executeAdvanceToNext(chatId, modelId);
          break;
        case 'wait_for_input':
          result = await this.executeWaitForInput(chatId, modelId);
          break;
        case 'complete_workflow':
          result = await this.executeCompleteWorkflow(chatId, modelId);
          break;
        default:
          throw new Error(`Unknown workflow action type: ${action.type}`);
      }

      // Log the action execution
      await this.stateManager.logStateTransition(chatId, {
        type: 'action_execution',
        from: state.currentPhase || 'unknown',
        to: result.newState?.currentPhase || state.currentPhase || 'unknown',
        reason: `Executed ${action.type}: ${result.message}`,
        timestamp: new Date().toISOString(),
        agentName: action.agentName,
        metadata: {
          actionType: action.type,
          success: result.success,
          confidence: action.confidence,
        },
      });

      // Update state if changes were made
      if (result.newState) {
        await this.stateManager.updateState(chatId, result.newState);
      }

      // Stream action result to UI
      if (dataStream) {
        dataStream.write({
          type: 'data-actionResult',
          data: {
            action: action.type,
            success: result.success,
            message: result.message,
            timestamp: new Date().toISOString(),
          },
          transient: false,
        });
      }

      // Determine follow-up actions if needed
      const followUpActions = result.success
        ? await this.determineFollowUpActions(chatId, action, modelId)
        : [];

      return {
        ...result,
        followUpActions,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';

      // Log the error
      await this.stateManager.logStateTransition(chatId, {
        type: 'action_error',
        from: 'executing',
        to: 'error',
        reason: `Failed to execute ${action.type}: ${errorMessage}`,
        timestamp: new Date().toISOString(),
        agentName: action.agentName,
        metadata: {
          actionType: action.type,
          error: errorMessage,
        },
      });

      return {
        success: false,
        message: `Failed to execute ${action.type}: ${errorMessage}`,
      };
    }
  }

  /**
   * Execute continue agent action
   */
  private async executeContinueAgent(
    chatId: string,
    agentName: AgentName,
    modelId: ChatModel['id'],
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    // Validate that the agent can be continued
    const currentAgentState = state.agentStates?.[agentName];
    if (currentAgentState === 'running') {
      return {
        success: false,
        message: `Agent ${agentName} is already running`,
      };
    }

    if (currentAgentState === 'completed') {
      return {
        success: false,
        message: `Agent ${agentName} has already completed`,
      };
    }

    // Check for pending clarifications
    if (state.pendingClarifications && state.pendingClarifications.length > 0) {
      return {
        success: false,
        message: `Cannot continue agent ${agentName} - there are ${state.pendingClarifications.length} pending clarifications`,
      };
    }

    // Update agent state to running
    const newAgentStates = {
      ...state.agentStates,
      [agentName]: 'running' as const,
    };

    // Update corresponding workflow step
    const updatedSteps =
      state.workflowSteps?.map((step) =>
        step.agentName === agentName
          ? {
              ...step,
              status: 'active' as StepStatus,
              startTime: step.startTime || new Date().toISOString(),
            }
          : step,
      ) || [];

    return {
      success: true,
      message: `Successfully resumed agent ${agentName}`,
      newState: {
        currentAgent: agentName,
        agentStates: newAgentStates,
        workflowSteps: updatedSteps,
      },
    };
  }

  /**
   * Execute advance to next step action
   */
  private async executeAdvanceToNext(
    chatId: string,
    modelId: ChatModel['id'],
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const currentStepIndex = state.currentStepIndex || 0;
    const nextStepIndex = currentStepIndex + 1;

    if (!state.workflowSteps || nextStepIndex >= state.workflowSteps.length) {
      // No more steps - complete the workflow
      return this.executeCompleteWorkflow(chatId, modelId);
    }

    const currentStep = state.workflowSteps[currentStepIndex];
    const nextStep = state.workflowSteps[nextStepIndex];

    // Mark current step as completed if it's active
    if (currentStep && currentStep.status === 'active') {
      currentStep.status = 'completed';
      currentStep.endTime = new Date().toISOString();
    }

    // Check dependencies for next step
    const unmetDependencies = nextStep.dependencies.filter((depId) => {
      const depStep = state.workflowSteps?.find((s) => s.id === depId);
      return !depStep || depStep.status !== 'completed';
    });

    if (unmetDependencies.length > 0) {
      return {
        success: false,
        message: `Cannot advance to ${nextStep.name} - unmet dependencies: ${unmetDependencies.join(', ')}`,
      };
    }

    // Activate next step
    nextStep.status = 'active';
    nextStep.startTime = new Date().toISOString();

    // Update agent states
    const newAgentStates = {
      ...state.agentStates,
      [nextStep.agentName]: 'running' as const,
    };

    // If current agent is different, mark it as completed
    if (currentStep && currentStep.agentName !== nextStep.agentName) {
      newAgentStates[currentStep.agentName] = 'completed';
    }

    return {
      success: true,
      message: `Advanced to step ${nextStepIndex + 1}: ${nextStep.name}`,
      newState: {
        currentStepIndex: nextStepIndex,
        currentAgent: nextStep.agentName,
        agentStates: newAgentStates,
        workflowSteps: [...state.workflowSteps],
      },
    };
  }

  /**
   * Execute wait for input action
   */
  private async executeWaitForInput(
    chatId: string,
    modelId: ChatModel['id'],
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    // Check if we have a current agent or need to determine the next agent to start
    let targetAgent = state.currentAgent;

    if (!targetAgent) {
      // Find the first agent that hasn't started yet
      const nextStep = state.workflowSteps?.find(
        (step) => step.status === 'pending' || step.status === 'not_started',
      );

      if (nextStep) {
        targetAgent = nextStep.agentName;
      } else {
        // If no pending steps, check if we have any active steps
        const activeStep = state.workflowSteps?.find(
          (step) => step.status === 'active',
        );

        if (activeStep) {
          targetAgent = activeStep.agentName;
        } else {
          return {
            success: false,
            message:
              'No agent available to wait for input - workflow may be complete or in an invalid state',
          };
        }
      }
    }

    const newAgentStates = {
      ...state.agentStates,
      [targetAgent]: 'waiting_for_clarification' as const,
    };

    // Update current step status
    const updatedSteps =
      state.workflowSteps?.map((step) =>
        step.agentName === targetAgent &&
        (step.status === 'active' || step.status === 'pending')
          ? { ...step, status: 'waiting_input' as StepStatus }
          : step,
      ) || [];

    return {
      success: true,
      message: `Waiting for user input to ${state.currentAgent ? 'continue' : 'start'} agent ${targetAgent}`,
      newState: {
        currentAgent: targetAgent, // Set the current agent if it wasn't set
        agentStates: newAgentStates,
        workflowSteps: updatedSteps,
        isWaitingForClarification: true,
      },
    };
  }

  /**
   * Execute complete workflow action
   */
  private async executeCompleteWorkflow(
    chatId: string,
    modelId: ChatModel['id'],
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    // Mark all remaining steps as completed
    const updatedSteps =
      state.workflowSteps?.map((step) => ({
        ...step,
        status:
          step.status === 'active' || step.status === 'pending'
            ? ('completed' as StepStatus)
            : step.status,
        endTime: step.endTime || new Date().toISOString(),
      })) || [];

    // Mark all agents as completed
    const completedAgentStates: Record<string, any> = {};
    Object.keys(state.agentStates || {}).forEach((agentName) => {
      completedAgentStates[agentName] = 'completed';
    });

    return {
      success: true,
      message: 'Workflow completed successfully',
      newState: {
        currentPhase: 'completed' as WorkflowPhase,
        workflowCompleted: true,
        completedAt: new Date().toISOString(),
        agentStates: completedAgentStates,
        workflowSteps: updatedSteps,
        isWaitingForClarification: false,
      },
    };
  }

  /**
   * Determine follow-up actions after successful action execution
   */
  private async determineFollowUpActions(
    chatId: string,
    completedAction: WorkflowAction,
    modelId: ChatModel['id'],
  ): Promise<WorkflowAction[]> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      return [];
    }

    // Use AI to determine if follow-up actions are needed
    const analysis = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        followUpActions: z.array(
          z.object({
            type: z.enum([
              'continue_agent',
              'advance_to_next',
              'wait_for_input',
              'complete_workflow',
            ]),
            agentName: z.string().optional(),
            reason: z.string(),
            userNotification: z.string(),
            autoExecute: z.boolean(),
            priority: z.enum(['low', 'medium', 'high']),
          }),
        ),
        reasoning: z.string(),
      }),
      prompt: `Analyze if follow-up actions are needed after completing: ${completedAction.type}

Current State After Action:
- Phase: ${state.currentPhase || 'unknown'}
- Current Agent: ${state.currentAgent || 'none'}
- Agent States: ${JSON.stringify(state.agentStates || {})}
- Workflow Completed: ${state.workflowCompleted || false}
- Pending Clarifications: ${state.pendingClarifications?.length || 0}

Completed Action Details:
- Type: ${completedAction.type}
- Agent: ${completedAction.agentName || 'none'}
- Reason: ${completedAction.reason}

Determine if any follow-up actions are needed:
- Should we automatically advance to the next step?
- Are there agents that should be started?
- Is the workflow ready to complete?
- Should we wait for additional input?

Only suggest follow-up actions that make logical sense and maintain workflow integrity.`,
      system: `You are an expert at workflow orchestration and action sequencing.
      Only suggest follow-up actions that are necessary and beneficial.
      Avoid creating action loops or unnecessary steps.`,
    });

    return analysis.object.followUpActions.map((action) => ({
      type: action.type,
      agentName: action.agentName as AgentName,
      reason: action.reason,
      userNotification: action.userNotification,
      autoExecute: action.autoExecute,
    }));
  }

  /**
   * Handle user-initiated actions (skip, restart, modify, help)
   */
  async handleUserAction(
    chatId: string,
    userAction: UserAction,
    modelId: ChatModel['id'],
    dataStream?: UIMessageStreamWriter<ChatMessage>,
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    try {
      let result: {
        success: boolean;
        message: string;
        newState?: Partial<EnhancedConversationState>;
      };

      switch (userAction.type) {
        case 'skip':
          result = await this.handleSkipAction(chatId, userAction, modelId);
          break;
        case 'restart':
          result = await this.handleRestartAction(chatId, userAction, modelId);
          break;
        case 'modify':
          result = await this.handleModifyAction(chatId, userAction, modelId);
          break;
        case 'help':
          result = await this.handleHelpAction(chatId, userAction, modelId);
          break;
        case 'continue':
          result = await this.handleContinueAction(chatId, userAction, modelId);
          break;
        default:
          throw new Error(`Unknown user action type: ${userAction.type}`);
      }

      // Log the user action
      await this.stateManager.logStateTransition(chatId, {
        type: 'user_action',
        from: 'user_input',
        to: 'action_executed',
        reason: `User executed ${userAction.type}: ${userAction.label}`,
        timestamp: new Date().toISOString(),
        metadata: {
          actionType: userAction.type,
          actionId: userAction.id,
          success: result.success,
        },
      });

      // Update state if changes were made
      if (result.newState) {
        await this.stateManager.updateState(chatId, result.newState);
      }

      // Stream user action result to UI
      if (dataStream) {
        dataStream.write({
          type: 'data-userActionResult',
          data: {
            action: userAction.type,
            actionId: userAction.id,
            success: result.success,
            message: result.message,
            timestamp: new Date().toISOString(),
          },
          transient: false,
        });
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';

      return {
        success: false,
        message: `Failed to execute user action ${userAction.type}: ${errorMessage}`,
      };
    }
  }

  /**
   * Handle skip action
   */
  private async handleSkipAction(
    chatId: string,
    userAction: UserAction,
    modelId: ChatModel['id'],
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const currentStepIndex = state.currentStepIndex || 0;
    const currentStep = state.workflowSteps?.[currentStepIndex];

    if (!currentStep) {
      return {
        success: false,
        message: 'No current step to skip',
      };
    }

    if (!currentStep.isOptional) {
      return {
        success: false,
        message: `Cannot skip required step: ${currentStep.name}`,
      };
    }

    // Mark step as skipped
    const updatedSteps = [...(state.workflowSteps || [])];
    updatedSteps[currentStepIndex] = {
      ...currentStep,
      status: 'skipped' as StepStatus,
      skipReason: 'User requested skip',
      endTime: new Date().toISOString(),
    };

    return {
      success: true,
      message: `Skipped optional step: ${currentStep.name}`,
      newState: {
        workflowSteps: updatedSteps,
      },
    };
  }

  /**
   * Handle restart action
   */
  private async handleRestartAction(
    chatId: string,
    userAction: UserAction,
    modelId: ChatModel['id'],
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
  }> {
    // Implementation for restart action
    return {
      success: true,
      message: 'Restart functionality not yet implemented',
    };
  }

  /**
   * Handle modify action
   */
  private async handleModifyAction(
    chatId: string,
    userAction: UserAction,
    modelId: ChatModel['id'],
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
  }> {
    // Implementation for modify action
    return {
      success: true,
      message: 'Modify functionality not yet implemented',
    };
  }

  /**
   * Handle help action
   */
  private async handleHelpAction(
    chatId: string,
    userAction: UserAction,
    modelId: ChatModel['id'],
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
  }> {
    // Implementation for help action
    return {
      success: true,
      message: 'Help functionality handled by GuidanceGenerator',
    };
  }

  /**
   * Handle continue action
   */
  private async handleContinueAction(
    chatId: string,
    userAction: UserAction,
    modelId: ChatModel['id'],
  ): Promise<{
    success: boolean;
    message: string;
    newState?: Partial<EnhancedConversationState>;
  }> {
    // Determine next action and execute it
    const nextAction = await this.determineNextAction(chatId, modelId);
    const result = await this.executeWorkflowAction(
      chatId,
      nextAction,
      modelId,
    );

    return {
      success: result.success,
      message: `Continue action: ${result.message}`,
      newState: result.newState,
    };
  }
}

/**
 * AI SDK V5 Tools for Workflow Action Handling
 */
export const createWorkflowActionTools = (
  chatId: string,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
  actionHandler: WorkflowActionHandler,
) => ({
  determineNextAction: tool({
    description: 'Analyze workflow state and determine the optimal next action',
    inputSchema: z.object({
      considerUserPreferences: z.boolean().default(true),
      includeRiskAssessment: z.boolean().default(true),
    }),
    execute: async ({ considerUserPreferences, includeRiskAssessment }) => {
      const action = await actionHandler.determineNextAction(chatId, modelId);

      // Stream action recommendation to UI
      dataStream.write({
        type: 'data-actionRecommendation',
        data: {
          ...action,
          timestamp: new Date().toISOString(),
        },
        transient: false,
      });

      return action;
    },
  }),

  executeWorkflowAction: tool({
    description: 'Execute a specific workflow action with error handling',
    inputSchema: z.object({
      action: z.object({
        type: z.enum([
          'continue_agent',
          'advance_to_next',
          'wait_for_input',
          'complete_workflow',
        ]),
        agentName: z.string().optional(),
        reason: z.string(),
        userNotification: z.string(),
        autoExecute: z.boolean(),
      }),
      dryRun: z.boolean().default(false),
    }),
    execute: async ({ action, dryRun }) => {
      if (dryRun) {
        return {
          success: true,
          message: `Dry run: Would execute ${action.type}`,
          dryRun: true,
        };
      }

      return await actionHandler.executeWorkflowAction(
        chatId,
        action,
        modelId,
        dataStream,
      );
    },
  }),

  handleUserAction: tool({
    description: 'Handle user-initiated workflow actions',
    inputSchema: z.object({
      userAction: z.object({
        id: z.string(),
        label: z.string(),
        description: z.string(),
        type: z.enum(['continue', 'skip', 'restart', 'modify', 'help']),
        enabled: z.boolean(),
      }),
    }),
    execute: async ({ userAction }) => {
      return await actionHandler.handleUserAction(
        chatId,
        userAction,
        modelId,
        dataStream,
      );
    },
  }),
});
