import { z } from 'zod';
import type { ChatModel } from '@/lib/ai/models';
import type {
  HITLError,
  RecoveryOption,
  EnhancedConversationState,
} from './types';
import type { AgentName } from '../conversation-state';
import { EnhancedStateManager } from './enhanced-state-manager';
import { UserPreferenceManager } from './user-preference-manager';
import { generateStructuredAnalysis } from './ai-sdk-integration';

/**
 * Recovery strategy templates for different error scenarios
 */
interface RecoveryStrategy {
  id: string;
  name: string;
  description: string;
  applicableErrorTypes: HITLError['type'][];
  riskLevel: 'low' | 'medium' | 'high';
  prerequisites: string[];
  estimatedSuccessRate: number;
  implementation: (context: RecoveryContext) => Promise<void>;
}

/**
 * Context for recovery operations
 */
interface RecoveryContext {
  chatId: string;
  error: HITLError;
  currentState: EnhancedConversationState;
  agentName?: AgentName;
  userPreferences?: any;
  additionalData?: Record<string, any>;
}

/**
 * RecoveryOptionGenerator creates intelligent recovery strategies for HITL system errors
 */
export class RecoveryOptionGenerator {
  private static recoveryStrategies: RecoveryStrategy[] = [
    // Question Processing Recovery Strategies
    {
      id: 'retry-with-fallback',
      name: 'Retry with Fallback',
      description: 'Retry the operation with simplified parameters',
      applicableErrorTypes: ['question_processing', 'validation'],
      riskLevel: 'low',
      prerequisites: [],
      estimatedSuccessRate: 0.8,
      implementation: async (context) => {
        console.log('Retrying with fallback parameters...');
        // Implementation would retry with simpler parameters
      },
    },
    {
      id: 'skip-ai-enhancement',
      name: 'Skip AI Enhancement',
      description: 'Continue without AI-powered enhancements',
      applicableErrorTypes: ['question_processing'],
      riskLevel: 'low',
      prerequisites: [],
      estimatedSuccessRate: 0.9,
      implementation: async (context) => {
        console.log('Skipping AI enhancement...');
        // Implementation would disable AI features temporarily
      },
    },
    {
      id: 'use-cached-response',
      name: 'Use Cached Response',
      description: 'Use a previously cached response if available',
      applicableErrorTypes: ['question_processing', 'validation'],
      riskLevel: 'low',
      prerequisites: ['cached_response_available'],
      estimatedSuccessRate: 0.7,
      implementation: async (context) => {
        console.log('Using cached response...');
        // Implementation would retrieve and use cached response
      },
    },

    // State Synchronization Recovery Strategies
    {
      id: 'force-state-reconciliation',
      name: 'Force State Reconciliation',
      description: 'Force a complete state reconciliation',
      applicableErrorTypes: ['state_sync'],
      riskLevel: 'medium',
      prerequisites: [],
      estimatedSuccessRate: 0.85,
      implementation: async (context) => {
        console.log('Forcing state reconciliation...');
        // Implementation would perform comprehensive state reconciliation
      },
    },
    {
      id: 'rollback-to-checkpoint',
      name: 'Rollback to Checkpoint',
      description: 'Rollback to the last known good state',
      applicableErrorTypes: ['state_sync', 'agent_execution'],
      riskLevel: 'medium',
      prerequisites: ['checkpoint_available'],
      estimatedSuccessRate: 0.9,
      implementation: async (context) => {
        console.log('Rolling back to checkpoint...');
        // Implementation would restore from checkpoint
      },
    },
    {
      id: 'reset-conversation-state',
      name: 'Reset Conversation State',
      description: 'Reset the conversation state to initial values',
      applicableErrorTypes: ['state_sync'],
      riskLevel: 'high',
      prerequisites: [],
      estimatedSuccessRate: 0.95,
      implementation: async (context) => {
        console.log('Resetting conversation state...');
        // Implementation would reset state to defaults
      },
    },

    // Workflow Advancement Recovery Strategies
    {
      id: 'manual-workflow-advance',
      name: 'Manual Workflow Advance',
      description: 'Manually advance the workflow to the next step',
      applicableErrorTypes: ['auto_advance'],
      riskLevel: 'low',
      prerequisites: [],
      estimatedSuccessRate: 0.9,
      implementation: async (context) => {
        console.log('Manually advancing workflow...');
        // Implementation would manually advance workflow
      },
    },
    {
      id: 'skip-current-step',
      name: 'Skip Current Step',
      description: 'Skip the current workflow step and continue',
      applicableErrorTypes: ['auto_advance', 'agent_execution'],
      riskLevel: 'medium',
      prerequisites: ['step_is_optional'],
      estimatedSuccessRate: 0.8,
      implementation: async (context) => {
        console.log('Skipping current step...');
        // Implementation would skip current step
      },
    },
    {
      id: 'restart-current-phase',
      name: 'Restart Current Phase',
      description: 'Restart the current workflow phase from the beginning',
      applicableErrorTypes: ['auto_advance', 'agent_execution'],
      riskLevel: 'high',
      prerequisites: [],
      estimatedSuccessRate: 0.85,
      implementation: async (context) => {
        console.log('Restarting current phase...');
        // Implementation would restart the current phase
      },
    },

    // Agent Execution Recovery Strategies
    {
      id: 'retry-agent-execution',
      name: 'Retry Agent Execution',
      description: 'Retry the failed agent with the same parameters',
      applicableErrorTypes: ['agent_execution'],
      riskLevel: 'low',
      prerequisites: [],
      estimatedSuccessRate: 0.6,
      implementation: async (context) => {
        console.log('Retrying agent execution...');
        // Implementation would retry agent execution
      },
    },
    {
      id: 'switch-to-fallback-agent',
      name: 'Switch to Fallback Agent',
      description: 'Use a simpler fallback agent for this operation',
      applicableErrorTypes: ['agent_execution'],
      riskLevel: 'medium',
      prerequisites: ['fallback_agent_available'],
      estimatedSuccessRate: 0.75,
      implementation: async (context) => {
        console.log('Switching to fallback agent...');
        // Implementation would switch to fallback agent
      },
    },

    // Validation Recovery Strategies
    {
      id: 'relax-validation-rules',
      name: 'Relax Validation Rules',
      description: 'Temporarily relax validation requirements',
      applicableErrorTypes: ['validation'],
      riskLevel: 'medium',
      prerequisites: [],
      estimatedSuccessRate: 0.9,
      implementation: async (context) => {
        console.log('Relaxing validation rules...');
        // Implementation would relax validation
      },
    },
    {
      id: 'request-user-confirmation',
      name: 'Request User Confirmation',
      description: 'Ask user to confirm proceeding despite validation issues',
      applicableErrorTypes: ['validation'],
      riskLevel: 'low',
      prerequisites: [],
      estimatedSuccessRate: 0.8,
      implementation: async (context) => {
        console.log('Requesting user confirmation...');
        // Implementation would request user confirmation
      },
    },

    // System Failure Recovery Strategies
    {
      id: 'graceful-degradation',
      name: 'Graceful Degradation',
      description: 'Continue with reduced functionality',
      applicableErrorTypes: ['system_failure'],
      riskLevel: 'low',
      prerequisites: [],
      estimatedSuccessRate: 0.7,
      implementation: async (context) => {
        console.log('Enabling graceful degradation...');
        // Implementation would enable degraded mode
      },
    },
    {
      id: 'emergency-save-and-restart',
      name: 'Emergency Save and Restart',
      description: 'Save current progress and restart the system',
      applicableErrorTypes: ['system_failure'],
      riskLevel: 'high',
      prerequisites: [],
      estimatedSuccessRate: 0.9,
      implementation: async (context) => {
        console.log('Emergency save and restart...');
        // Implementation would save and restart
      },
    },
  ];

  /**
   * Generate recovery options for a specific error
   */
  static async generateRecoveryOptions(
    error: HITLError,
    chatId: string,
    modelId: ChatModel['id'],
    options: {
      maxOptions?: number;
      includeHighRisk?: boolean;
      preferAutomated?: boolean;
    } = {},
  ): Promise<RecoveryOption[]> {
    const {
      maxOptions = 5,
      includeHighRisk = false,
      preferAutomated = true,
    } = options;

    try {
      // Get current context
      const context = await RecoveryOptionGenerator.buildRecoveryContext(
        error,
        chatId,
      );

      // Find applicable strategies
      let applicableStrategies =
        RecoveryOptionGenerator.recoveryStrategies.filter((strategy) =>
          strategy.applicableErrorTypes.includes(error.type),
        );

      // Filter by risk level if requested
      if (!includeHighRisk) {
        applicableStrategies = applicableStrategies.filter(
          (strategy) => strategy.riskLevel !== 'high',
        );
      }

      // Check prerequisites
      applicableStrategies =
        await RecoveryOptionGenerator.filterByPrerequisites(
          applicableStrategies,
          context,
        );

      // Sort by success rate and user preferences
      applicableStrategies.sort((a, b) => {
        if (preferAutomated) {
          // Prefer low-risk, high-success strategies
          const scoreA =
            a.estimatedSuccessRate *
            (a.riskLevel === 'low'
              ? 1.2
              : a.riskLevel === 'medium'
                ? 1.0
                : 0.8);
          const scoreB =
            b.estimatedSuccessRate *
            (b.riskLevel === 'low'
              ? 1.2
              : b.riskLevel === 'medium'
                ? 1.0
                : 0.8);
          return scoreB - scoreA;
        }
        return b.estimatedSuccessRate - a.estimatedSuccessRate;
      });

      // Limit to max options
      applicableStrategies = applicableStrategies.slice(0, maxOptions);

      // Use AI to enhance and customize recovery options
      const enhancedOptions =
        await RecoveryOptionGenerator.enhanceRecoveryOptions(
          applicableStrategies,
          context,
          modelId,
        );

      // Convert to RecoveryOption format
      return enhancedOptions.map((strategy) => ({
        id: strategy.id,
        label: strategy.name,
        description: strategy.description,
        riskLevel: strategy.riskLevel,
        action: async () => {
          await strategy.implementation(context);
        },
      }));
    } catch (generationError) {
      console.warn('Failed to generate recovery options:', generationError);
      return RecoveryOptionGenerator.getFallbackRecoveryOptions(error);
    }
  }

  /**
   * Build recovery context from error and current state
   */
  private static async buildRecoveryContext(
    error: HITLError,
    chatId: string,
  ): Promise<RecoveryContext> {
    try {
      const currentState = EnhancedStateManager.getEnhancedState(chatId);
      const userPreferences = UserPreferenceManager.getUserPreferences(chatId);

      return {
        chatId,
        error,
        currentState,
        agentName: currentState.currentAgent,
        userPreferences,
        additionalData: {
          workflowPhase: currentState.workflowPhase,
          pendingClarifications: currentState.pendingClarifications.size,
          workflowSteps: currentState.workflowSteps.length,
        },
      };
    } catch (contextError) {
      console.warn('Failed to build recovery context:', contextError);
      return {
        chatId,
        error,
        currentState: {} as EnhancedConversationState,
      };
    }
  }

  /**
   * Filter strategies by checking prerequisites
   */
  private static async filterByPrerequisites(
    strategies: RecoveryStrategy[],
    context: RecoveryContext,
  ): Promise<RecoveryStrategy[]> {
    const filtered: RecoveryStrategy[] = [];

    for (const strategy of strategies) {
      if (strategy.prerequisites.length === 0) {
        filtered.push(strategy);
        continue;
      }

      let prerequisitesMet = true;
      for (const prerequisite of strategy.prerequisites) {
        const met = await RecoveryOptionGenerator.checkPrerequisite(
          prerequisite,
          context,
        );
        if (!met) {
          prerequisitesMet = false;
          break;
        }
      }

      if (prerequisitesMet) {
        filtered.push(strategy);
      }
    }

    return filtered;
  }

  /**
   * Check if a prerequisite is met
   */
  private static async checkPrerequisite(
    prerequisite: string,
    context: RecoveryContext,
  ): Promise<boolean> {
    switch (prerequisite) {
      case 'cached_response_available':
        // Check if there are cached responses
        return context.currentState.questionHistory?.size > 0;

      case 'checkpoint_available':
        // Check if there are state checkpoints
        return context.currentState.stateTransitionLog?.length > 0;

      case 'step_is_optional':
        // Check if current step is optional
        const currentStep = context.currentState.workflowSteps?.find(
          (step) => step.status === 'active',
        );
        return currentStep?.isOptional || false;

      case 'fallback_agent_available':
        // Check if fallback agents are available
        return true; // Assume fallback agents are always available

      default:
        console.warn(`Unknown prerequisite: ${prerequisite}`);
        return false;
    }
  }

  /**
   * Enhance recovery options using AI
   */
  private static async enhanceRecoveryOptions(
    strategies: RecoveryStrategy[],
    context: RecoveryContext,
    modelId: ChatModel['id'],
  ): Promise<RecoveryStrategy[]> {
    try {
      const enhancement = await generateStructuredAnalysis(
        modelId,
        z.object({
          enhancedStrategies: z.array(
            z.object({
              id: z.string(),
              customizedDescription: z.string(),
              contextSpecificSteps: z.array(z.string()),
              estimatedTime: z.string(),
              userFriendlyExplanation: z.string(),
            }),
          ),
        }),
        `Enhance these recovery strategies for the current error context:
         Error: ${context.error.type} - ${context.error.message}
         Current State: ${JSON.stringify({
           phase: context.currentState.workflowPhase,
           agent: context.agentName,
           pendingClarifications: context.additionalData?.pendingClarifications,
         })}
         
         Strategies: ${JSON.stringify(
           strategies.map((s) => ({
             id: s.id,
             name: s.name,
             description: s.description,
           })),
         )}
         
         Customize the descriptions and provide context-specific guidance.`,
        'You are an expert at providing clear, actionable recovery guidance for technical issues.',
      );

      // Apply enhancements to strategies
      return strategies.map((strategy) => {
        const enhancement_item = enhancement.enhancedStrategies.find(
          (e) => e.id === strategy.id,
        );
        if (enhancement_item) {
          return {
            ...strategy,
            description: enhancement_item.customizedDescription,
            name: `${strategy.name} (${enhancement_item.estimatedTime})`,
          };
        }
        return strategy;
      });
    } catch (enhancementError) {
      console.warn(
        'Failed to enhance recovery options with AI:',
        enhancementError,
      );
      return strategies;
    }
  }

  /**
   * Get fallback recovery options when generation fails
   */
  private static getFallbackRecoveryOptions(
    error: HITLError,
  ): RecoveryOption[] {
    const fallbackOptions: RecoveryOption[] = [
      {
        id: 'retry-operation',
        label: 'Retry Operation',
        description: 'Retry the failed operation',
        riskLevel: 'low',
        action: async () => {
          console.log('Retrying operation...');
        },
      },
      {
        id: 'continue-anyway',
        label: 'Continue Anyway',
        description: 'Continue the workflow despite the error',
        riskLevel: 'medium',
        action: async () => {
          console.log('Continuing anyway...');
        },
      },
      {
        id: 'get-help',
        label: 'Get Help',
        description: 'Get additional help and guidance',
        riskLevel: 'low',
        action: async () => {
          console.log('Getting help...');
        },
      },
    ];

    // Add error-specific fallback options
    if (error.type === 'validation') {
      fallbackOptions.unshift({
        id: 'skip-validation',
        label: 'Skip Validation',
        description: 'Skip validation and continue',
        riskLevel: 'high',
        action: async () => {
          console.log('Skipping validation...');
        },
      });
    }

    return fallbackOptions;
  }

  /**
   * Execute a recovery strategy
   */
  static async executeRecoveryStrategy(
    strategyId: string,
    error: HITLError,
    chatId: string,
  ): Promise<{ success: boolean; message: string; nextSteps: string[] }> {
    try {
      const strategy = RecoveryOptionGenerator.recoveryStrategies.find(
        (s) => s.id === strategyId,
      );
      if (!strategy) {
        return {
          success: false,
          message: `Recovery strategy ${strategyId} not found`,
          nextSteps: ['Try a different recovery option'],
        };
      }

      const context = await RecoveryOptionGenerator.buildRecoveryContext(
        error,
        chatId,
      );
      await strategy.implementation(context);

      return {
        success: true,
        message: `Recovery strategy "${strategy.name}" executed successfully`,
        nextSteps: ['Continue with workflow', 'Monitor for similar issues'],
      };
    } catch (executionError) {
      console.error(
        `Failed to execute recovery strategy ${strategyId}:`,
        executionError,
      );
      return {
        success: false,
        message: `Recovery strategy execution failed: ${executionError instanceof Error ? executionError.message : 'Unknown error'}`,
        nextSteps: ['Try alternative recovery option', 'Contact support'],
      };
    }
  }

  /**
   * Get available recovery strategies for an error type
   */
  static getAvailableStrategies(
    errorType: HITLError['type'],
  ): RecoveryStrategy[] {
    return RecoveryOptionGenerator.recoveryStrategies.filter((strategy) =>
      strategy.applicableErrorTypes.includes(errorType),
    );
  }

  /**
   * Add custom recovery strategy
   */
  static addCustomStrategy(strategy: RecoveryStrategy): void {
    RecoveryOptionGenerator.recoveryStrategies.push(strategy);
  }
}
