import { z } from 'zod';
import { tool, type UIMessageStreamWriter } from 'ai';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type {
  UserAction,
  WorkflowGuidance,
  UserPreferences,
  EnhancedConversationState,
} from './types';
import type { AgentName, WorkflowPhase } from '../conversation-state';
import { EnhancedStateManager } from './enhanced-state-manager';
import { UserPreferenceManager } from './user-preference-manager';
import { WorkflowOrchestrator } from './workflow-orchestrator';
import { generateStructuredAnalysis, streamToUI } from './ai-sdk-integration';

/**
 * Result of executing a user action
 */
export interface UserActionResult {
  success: boolean;
  actionId: string;
  actionType: UserAction['type'];
  message: string;
  nextSteps?: string[];
  stateChanges?: string[];
  consequences?: string[];
  estimatedImpact?: string;
  canUndo?: boolean;
  undoInstructions?: string;
}

/**
 * Context for action execution
 */
interface ActionContext {
  chatId: string;
  currentState: EnhancedConversationState;
  userPreferences: UserPreferences;
  modelId: ChatModel['id'];
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

/**
 * UserActionHandler processes user workflow commands like skip, restart, modify, and help
 */
export class UserActionHandler {
  /**
   * Execute a user action with validation and consequence analysis
   */
  static async executeAction(
    chatId: string,
    action: UserAction,
    modelId: ChatModel['id'],
    dataStream: UIMessageStreamWriter<ChatMessage>,
    options: {
      skipValidation?: boolean;
      dryRun?: boolean;
      confirmConsequences?: boolean;
    } = {},
  ): Promise<UserActionResult> {
    const {
      skipValidation = false,
      dryRun = false,
      confirmConsequences = true,
    } = options;

    try {
      // Get current context
      const context: ActionContext = {
        chatId,
        currentState: EnhancedStateManager.getEnhancedState(chatId),
        userPreferences: UserPreferenceManager.getUserPreferences(chatId),
        modelId,
        dataStream,
      };

      // Validate action if not skipped
      if (!skipValidation) {
        const validation = await UserActionHandler.validateAction(
          action,
          context,
        );
        if (!validation.isValid) {
          return {
            success: false,
            actionId: action.id,
            actionType: action.type,
            message: `Action validation failed: ${validation.issues.join(', ')}`,
            consequences: validation.issues,
          };
        }
      }

      // Analyze consequences if requested
      let consequences: string[] = [];
      if (confirmConsequences && !dryRun) {
        consequences = await UserActionHandler.analyzeConsequences(
          action,
          context,
        );
      }

      // Execute the action based on type
      let result: UserActionResult;
      switch (action.type) {
        case 'continue':
          result = await UserActionHandler.handleContinueAction(
            action,
            context,
            dryRun,
          );
          break;
        case 'skip':
          result = await UserActionHandler.handleSkipAction(
            action,
            context,
            dryRun,
          );
          break;
        case 'restart':
          result = await UserActionHandler.handleRestartAction(
            action,
            context,
            dryRun,
          );
          break;
        case 'modify':
          result = await UserActionHandler.handleModifyAction(
            action,
            context,
            dryRun,
          );
          break;
        case 'help':
          result = await UserActionHandler.handleHelpAction(
            action,
            context,
            dryRun,
          );
          break;
        default:
          return {
            success: false,
            actionId: action.id,
            actionType: action.type,
            message: `Unknown action type: ${action.type}`,
          };
      }

      // Add consequences to result
      if (consequences.length > 0) {
        result.consequences = consequences;
      }

      // Stream result to UI
      streamToUI(dataStream, 'data-userActionResult', result);

      return result;
    } catch (error) {
      console.error(`Failed to execute user action ${action.id}:`, error);
      const errorResult: UserActionResult = {
        success: false,
        actionId: action.id,
        actionType: action.type,
        message: `Action execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };

      streamToUI(dataStream, 'data-userActionResult', errorResult);
      return errorResult;
    }
  }

  /**
   * Validate a user action before execution
   */
  private static async validateAction(
    action: UserAction,
    context: ActionContext,
  ): Promise<{
    isValid: boolean;
    issues: string[];
    warnings: string[];
  }> {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check if action is enabled
    if (!action.enabled) {
      issues.push('Action is currently disabled');
    }

    // Validate based on action type
    switch (action.type) {
      case 'skip':
        if (
          !context.currentState.workflowSteps.some(
            (step) => step.isOptional && step.status === 'active',
          )
        ) {
          issues.push('No optional steps available to skip');
        }
        break;

      case 'restart':
        if (context.currentState.workflowSteps.length === 0) {
          issues.push('No workflow to restart');
        }
        break;

      case 'modify':
        if (context.currentState.isWaitingForClarification) {
          warnings.push(
            'Modifying workflow while waiting for clarifications may cause issues',
          );
        }
        break;

      case 'continue':
        if (
          !context.currentState.isWaitingForClarification &&
          !context.currentState.workflowSteps.some(
            (step) => step.status === 'waiting_input',
          )
        ) {
          warnings.push('No pending actions to continue');
        }
        break;
    }

    // Check user preferences compatibility
    if (action.type === 'skip' && !context.userPreferences.skipOptionalSteps) {
      warnings.push(
        'This action conflicts with your preference to not skip optional steps',
      );
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Analyze consequences of executing an action
   */
  private static async analyzeConsequences(
    action: UserAction,
    context: ActionContext,
  ): Promise<string[]> {
    try {
      const consequenceAnalysis = await generateStructuredAnalysis(
        context.modelId,
        z.object({
          consequences: z.array(z.string()),
          severity: z.enum(['low', 'medium', 'high']),
          reversible: z.boolean(),
          estimatedImpact: z.string(),
        }),
        `Analyze the consequences of this user action:
         Action: ${action.type} - ${action.label}
         Description: ${action.description}
         Current Workflow Phase: ${context.currentState.workflowPhase}
         Current Agent: ${context.currentState.currentAgent || 'none'}
         Pending Clarifications: ${context.currentState.pendingClarifications.size}
         Workflow Steps: ${context.currentState.workflowSteps.length}
         
         What are the potential consequences and impacts of this action?`,
        'You are an expert at analyzing workflow impacts and user action consequences.',
      );

      return consequenceAnalysis.consequences;
    } catch (error) {
      console.warn('Failed to analyze action consequences:', error);
      return [
        `Executing ${action.type} action may affect the current workflow state`,
      ];
    }
  }

  /**
   * Handle continue action - resume workflow or advance to next step
   */
  private static async handleContinueAction(
    action: UserAction,
    context: ActionContext,
    dryRun: boolean,
  ): Promise<UserActionResult> {
    if (dryRun) {
      return {
        success: true,
        actionId: action.id,
        actionType: 'continue',
        message: 'Would continue workflow execution',
        nextSteps: ['Resume current agent', 'Process pending clarifications'],
      };
    }

    const stateChanges: string[] = [];

    // Resume workflow if paused
    if (context.currentState.isWaitingForClarification) {
      // Check if all clarifications are answered
      const pendingCount = context.currentState.pendingClarifications.size;
      if (pendingCount > 0) {
        return {
          success: false,
          actionId: action.id,
          actionType: 'continue',
          message: `Cannot continue: ${pendingCount} clarification(s) still pending`,
        };
      }

      EnhancedStateManager.updateEnhancedState(
        context.chatId,
        (state) => {
          state.isWaitingForClarification = false;
          if (state.activeAskingAgent) {
            state.currentAgent = state.activeAskingAgent;
            state.activeAskingAgent = undefined;
          }
        },
        'User action: Continue workflow',
      );
      stateChanges.push('Resumed workflow execution');
    }

    // Advance to next step if possible
    const nextAgent = await WorkflowOrchestrator.determineNextAgent(
      context.chatId,
      context.modelId,
    );

    if (nextAgent) {
      EnhancedStateManager.updateEnhancedState(
        context.chatId,
        (state) => {
          state.currentAgent = nextAgent as AgentName;
        },
        'User action: Advanced to next agent',
      );
      stateChanges.push(`Advanced to ${nextAgent}`);
    }

    return {
      success: true,
      actionId: action.id,
      actionType: 'continue',
      message: 'Workflow continued successfully',
      stateChanges,
      nextSteps: nextAgent
        ? [`Execute ${nextAgent}`]
        : ['Workflow may be complete'],
      canUndo: true,
      undoInstructions: 'Use the restart action to return to previous state',
    };
  }

  /**
   * Handle skip action - skip optional steps or current step
   */
  private static async handleSkipAction(
    action: UserAction,
    context: ActionContext,
    dryRun: boolean,
  ): Promise<UserActionResult> {
    const optionalSteps = context.currentState.workflowSteps.filter(
      (step) =>
        step.isOptional &&
        (step.status === 'active' || step.status === 'pending'),
    );

    if (optionalSteps.length === 0) {
      return {
        success: false,
        actionId: action.id,
        actionType: 'skip',
        message: 'No optional steps available to skip',
      };
    }

    if (dryRun) {
      return {
        success: true,
        actionId: action.id,
        actionType: 'skip',
        message: `Would skip ${optionalSteps.length} optional step(s)`,
        nextSteps: optionalSteps.map((step) => `Skip: ${step.name}`),
      };
    }

    const stateChanges: string[] = [];
    const skippedSteps: string[] = [];

    EnhancedStateManager.updateEnhancedState(
      context.chatId,
      (state) => {
        for (const step of optionalSteps) {
          const stateStep = state.workflowSteps.find((s) => s.id === step.id);
          if (stateStep) {
            stateStep.status = 'skipped';
            stateStep.skipReason = 'User requested skip';
            stateStep.endTime = new Date().toISOString();
            skippedSteps.push(stateStep.name);
          }
        }
      },
      `User action: Skipped ${optionalSteps.length} optional steps`,
    );

    stateChanges.push(`Skipped ${optionalSteps.length} optional steps`);

    return {
      success: true,
      actionId: action.id,
      actionType: 'skip',
      message: `Successfully skipped ${optionalSteps.length} optional step(s)`,
      stateChanges,
      nextSteps: [`Continue with next required step`],
      consequences: skippedSteps.map((step) => `${step} will not be executed`),
      canUndo: false, // Skipped steps cannot be easily undone
    };
  }

  /**
   * Handle restart action - restart workflow or specific phase
   */
  private static async handleRestartAction(
    action: UserAction,
    context: ActionContext,
    dryRun: boolean,
  ): Promise<UserActionResult> {
    if (dryRun) {
      return {
        success: true,
        actionId: action.id,
        actionType: 'restart',
        message: 'Would restart the current workflow phase',
        nextSteps: [
          'Reset current phase',
          'Clear pending clarifications',
          'Restart from beginning',
        ],
      };
    }

    const stateChanges: string[] = [];

    // Determine what to restart based on current state
    const currentPhase = context.currentState.workflowPhase;

    EnhancedStateManager.updateEnhancedState(
      context.chatId,
      (state) => {
        // Clear current execution state
        state.isWaitingForClarification = false;
        state.pendingClarifications.clear();
        state.currentAgent = undefined;
        state.activeAskingAgent = undefined;

        // Reset workflow steps for current phase
        for (const step of state.workflowSteps) {
          if (
            step.status === 'active' ||
            step.status === 'waiting_input' ||
            step.status === 'failed'
          ) {
            step.status = 'pending';
            step.startTime = undefined;
            step.endTime = undefined;
          }
        }

        // Reset to beginning of current phase
        switch (currentPhase) {
          case 'planning':
            state.currentAgent = 'core_agent';
            break;
          case 'design':
            state.currentAgent = 'diagram_agent';
            break;
          case 'implementation':
            state.currentAgent = 'terraform_agent';
            break;
        }
      },
      `User action: Restart ${currentPhase} phase`,
    );

    stateChanges.push(`Restarted ${currentPhase} phase`);
    stateChanges.push('Cleared pending clarifications');
    stateChanges.push('Reset workflow steps');

    return {
      success: true,
      actionId: action.id,
      actionType: 'restart',
      message: `Successfully restarted ${currentPhase} phase`,
      stateChanges,
      nextSteps: [`Begin ${currentPhase} phase from start`],
      consequences: ['Previous progress in this phase will be lost'],
      canUndo: false, // Restart cannot be easily undone
      estimatedImpact: 'Medium - will lose current phase progress',
    };
  }

  /**
   * Handle modify action - modify workflow parameters or state
   */
  private static async handleModifyAction(
    action: UserAction,
    context: ActionContext,
    dryRun: boolean,
  ): Promise<UserActionResult> {
    if (dryRun) {
      return {
        success: true,
        actionId: action.id,
        actionType: 'modify',
        message: 'Would open modification interface',
        nextSteps: ['Show modifiable parameters', 'Allow user to make changes'],
      };
    }

    // For modify actions, we typically need additional parameters
    // This is a placeholder that would integrate with a UI for modifications
    const modifiableAspects = [
      'User preferences',
      'Workflow parameters',
      'Agent configurations',
      'Clarification responses',
    ];

    return {
      success: true,
      actionId: action.id,
      actionType: 'modify',
      message: 'Modification interface available',
      nextSteps: modifiableAspects.map((aspect) => `Modify: ${aspect}`),
      canUndo: true,
      undoInstructions: 'Changes can be reverted through preference management',
    };
  }

  /**
   * Handle help action - provide contextual help and guidance
   */
  private static async handleHelpAction(
    action: UserAction,
    context: ActionContext,
    dryRun: boolean,
  ): Promise<UserActionResult> {
    try {
      const helpContent = await generateStructuredAnalysis(
        context.modelId,
        z.object({
          helpSections: z.array(
            z.object({
              title: z.string(),
              content: z.string(),
              examples: z.array(z.string()).optional(),
            }),
          ),
          quickActions: z.array(z.string()),
          relatedTopics: z.array(z.string()),
        }),
        `Generate contextual help for the user's current situation:
         Current Phase: ${context.currentState.workflowPhase}
         Current Agent: ${context.currentState.currentAgent || 'none'}
         Waiting for Clarification: ${context.currentState.isWaitingForClarification}
         Pending Clarifications: ${context.currentState.pendingClarifications.size}
         Workflow Steps: ${context.currentState.workflowSteps.length}
         User Preferences: ${JSON.stringify(context.userPreferences)}
         
         Provide helpful guidance for what the user can do next.`,
        'You are a helpful assistant providing contextual workflow guidance.',
      );

      if (!dryRun) {
        // Stream help content to UI
        streamToUI(context.dataStream, 'data-contextualHelp', {
          helpContent: helpContent.helpSections,
          quickActions: helpContent.quickActions,
          relatedTopics: helpContent.relatedTopics,
          currentContext: {
            phase: context.currentState.workflowPhase,
            agent: context.currentState.currentAgent,
            waitingForClarification:
              context.currentState.isWaitingForClarification,
          },
        });
      }

      return {
        success: true,
        actionId: action.id,
        actionType: 'help',
        message: 'Contextual help provided',
        nextSteps: helpContent.quickActions,
      };
    } catch (error) {
      console.warn('Failed to generate contextual help:', error);

      // Fallback help content
      const fallbackHelp = UserActionHandler.generateFallbackHelp(context);

      if (!dryRun) {
        streamToUI(context.dataStream, 'data-contextualHelp', fallbackHelp);
      }

      return {
        success: true,
        actionId: action.id,
        actionType: 'help',
        message: 'Basic help provided',
        nextSteps: fallbackHelp.quickActions,
      };
    }
  }

  /**
   * Generate fallback help content when AI generation fails
   */
  private static generateFallbackHelp(context: ActionContext) {
    const quickActions: string[] = [];
    const helpSections = [];

    // Add context-specific help
    if (context.currentState.isWaitingForClarification) {
      helpSections.push({
        title: 'Pending Clarifications',
        content: `You have ${context.currentState.pendingClarifications.size} pending clarification(s). Please answer them to continue the workflow.`,
      });
      quickActions.push('Answer pending clarifications');
    }

    if (context.currentState.currentAgent) {
      helpSections.push({
        title: 'Current Agent',
        content: `The ${context.currentState.currentAgent} is currently active. This agent handles ${UserActionHandler.getAgentDescription(context.currentState.currentAgent)}.`,
      });
    }

    // Add general help
    helpSections.push({
      title: 'Available Actions',
      content:
        'You can continue the workflow, skip optional steps, restart phases, modify settings, or get help at any time.',
    });

    quickActions.push(
      'Continue workflow',
      'View preferences',
      'Get status update',
    );

    return {
      helpContent: helpSections,
      quickActions,
      relatedTopics: ['Workflow phases', 'User preferences', 'Agent roles'],
    };
  }

  /**
   * Get description for an agent
   */
  private static getAgentDescription(agentName: AgentName): string {
    switch (agentName) {
      case 'core_agent':
        return 'requirement gathering and project planning';
      case 'diagram_agent':
        return 'architecture design and diagram creation';
      case 'terraform_agent':
        return 'infrastructure code generation and deployment planning';
      default:
        return 'workflow execution';
    }
  }

  /**
   * Get available actions for current workflow state
   */
  static getAvailableActions(
    chatId: string,
    modelId: ChatModel['id'],
  ): UserAction[] {
    try {
      const state = EnhancedStateManager.getEnhancedState(chatId);
      const preferences = UserPreferenceManager.getUserPreferences(chatId);
      const actions: UserAction[] = [];

      // Continue action
      if (
        state.isWaitingForClarification ||
        state.workflowSteps.some((step) => step.status === 'waiting_input')
      ) {
        actions.push({
          id: 'continue-workflow',
          label: 'Continue',
          description: 'Resume workflow execution',
          type: 'continue',
          enabled:
            !state.isWaitingForClarification ||
            state.pendingClarifications.size === 0,
          riskLevel: 'low',
        });
      }

      // Skip action
      const hasOptionalSteps = state.workflowSteps.some(
        (step) =>
          step.isOptional &&
          (step.status === 'active' || step.status === 'pending'),
      );
      if (hasOptionalSteps) {
        actions.push({
          id: 'skip-optional',
          label: 'Skip Optional Steps',
          description: 'Skip optional workflow steps',
          type: 'skip',
          enabled: true,
          consequences: 'Optional features will not be implemented',
          riskLevel: 'low',
        });
      }

      // Restart action
      if (state.workflowSteps.length > 0) {
        actions.push({
          id: 'restart-phase',
          label: 'Restart Phase',
          description: `Restart the ${state.workflowPhase} phase`,
          type: 'restart',
          enabled: true,
          consequences: 'Current phase progress will be lost',
          riskLevel: 'medium',
        });
      }

      // Modify action
      actions.push({
        id: 'modify-settings',
        label: 'Modify Settings',
        description: 'Modify workflow parameters and preferences',
        type: 'modify',
        enabled: true,
        riskLevel: 'low',
      });

      // Help action
      actions.push({
        id: 'get-help',
        label: 'Get Help',
        description: 'Get contextual help and guidance',
        type: 'help',
        enabled: true,
        riskLevel: 'low',
      });

      return actions;
    } catch (error) {
      console.error('Failed to get available actions:', error);
      return [
        {
          id: 'get-help',
          label: 'Get Help',
          description: 'Get help with the current situation',
          type: 'help',
          enabled: true,
          riskLevel: 'low',
        },
      ];
    }
  }
}

/**
 * Create AI tools for user action handling
 */
export function createUserActionTools(
  chatId: string,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
) {
  return {
    executeUserAction: tool({
      description:
        'Execute a user workflow action with validation and consequence analysis',
      inputSchema: z.object({
        actionId: z.string().describe('ID of the action to execute'),
        actionType: z.enum(['continue', 'skip', 'restart', 'modify', 'help']),
        label: z.string().describe('Human-readable label for the action'),
        description: z.string().describe('Description of what the action does'),
        confirmConsequences: z
          .boolean()
          .default(true)
          .describe('Whether to analyze consequences before execution'),
        dryRun: z
          .boolean()
          .default(false)
          .describe('Whether to simulate the action without executing it'),
      }),
      execute: async ({
        actionId,
        actionType,
        label,
        description,
        confirmConsequences,
        dryRun,
      }) => {
        const action: UserAction = {
          id: actionId,
          label,
          description,
          type: actionType,
          enabled: true,
        };

        return await UserActionHandler.executeAction(
          chatId,
          action,
          modelId,
          dataStream,
          { confirmConsequences, dryRun },
        );
      },
    }),

    getAvailableActions: tool({
      description:
        'Get list of available user actions for current workflow state',
      inputSchema: z.object({
        includeDisabled: z
          .boolean()
          .default(false)
          .describe('Whether to include disabled actions'),
      }),
      execute: async ({ includeDisabled }) => {
        const actions = UserActionHandler.getAvailableActions(chatId, modelId);
        const filteredActions = includeDisabled
          ? actions
          : actions.filter((a) => a.enabled);

        // Stream available actions to UI
        streamToUI(dataStream, 'data-userActionRequest', {
          availableActions: filteredActions,
          currentContext: `Current workflow state for chat ${chatId}`,
          recommendedAction: filteredActions.find((a) => a.type === 'continue'),
        });

        return {
          availableActions: filteredActions,
          totalActions: actions.length,
          enabledActions: actions.filter((a) => a.enabled).length,
        };
      },
    }),
  };
}
