import { generateObject, tool } from 'ai';
import { z } from 'zod';
import type { UIMessageStreamWriter } from 'ai/rsc';
import type { ChatMessage } from '@/lib/types';
import type { AgentName } from '../conversation-state';
import type {
  WorkflowAction,
  WorkflowGuidance,
  UserAction,
  PhaseExplanation,
  WorkflowPhase,
} from './types';
import type { EnhancedStateManager } from './enhanced-state-manager';
import { myProvider } from '@/lib/ai/providers';

/**
 * WorkflowOrchestrator manages intelligent workflow progression using AI SDK V5
 * for decision making, auto-advancement, and user guidance generation.
 */
export class WorkflowOrchestrator {
  private stateManager: EnhancedStateManager;

  constructor(stateManager: EnhancedStateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Determines the next workflow action using AI-powered analysis
   */
  async determineNextAction(
    chatId: string,
    modelId: string,
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
        agentName: z
          .enum(['core_agent', 'diagram_agent', 'terraform_agent'])
          .optional(),
        confidence: z.number().min(0).max(1),
        reasoning: z.string(),
        userNotification: z.string(),
        autoExecute: z.boolean(),
        estimatedDuration: z.string().optional(),
      }),
      prompt: `Analyze the current workflow state and recommend the next action:

Current State:
- Phase: ${state.currentPhase || 'unknown'}
- Current Agent: ${state.currentAgent || 'none'}
- Agent States: ${JSON.stringify(state.agentStates || {})}
- Pending Clarifications: ${state.pendingClarifications?.length || 0}
- Waiting for Clarification: ${state.isWaitingForClarification || false}

Workflow Steps:
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
- Skip optional steps: ${state.userPreferences?.skipOptionalSteps || false}
- Auto-advance timeout: ${state.userPreferences?.timeoutForAutoAdvance || 30}s
- Preferred question format: ${state.userPreferences?.preferredQuestionFormat || 'mixed'}

Available Agents: core_agent, diagram_agent, terraform_agent

Decision Logic (considering user preferences):
1. If no current agent and workflow just started -> recommend 'wait_for_input' with agentName: 'core_agent'
2. If current agent is running and no clarifications -> recommend 'continue_agent' with current agent
3. If current agent completed -> recommend 'advance_to_next' 
4. If all agents completed -> recommend 'complete_workflow'
5. If waiting for clarification -> recommend 'wait_for_input' with current agent

User Preference Considerations:
- If auto-advance is 'never', set autoExecute to false
- If auto-advance is 'always', set autoExecute to true
- If auto-advance is 'ask', set autoExecute based on step requirements and timeout
- If skipOptionalSteps is true, consider skipping optional steps in recommendations
- Adjust userNotification verbosity based on verbosityLevel preference

IMPORTANT: Always provide agentName when recommending 'wait_for_input' or 'continue_agent' actions.
Consider user preferences when setting autoExecute and crafting userNotification.

Provide a clear recommendation with reasoning that respects user preferences.`,
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
   * Checks if workflow can auto-advance based on current state and user preferences
   */
  async canAutoAdvance(chatId: string): Promise<boolean> {
    const state = await this.stateManager.getState(chatId);
    if (!state) return false;

    // Get user preferences with enhanced preference handling
    const userPrefs = state.userPreferences || {};

    // Respect user's auto-advance preference
    if (userPrefs.autoAdvancePreference === 'never') {
      console.log(
        '[WorkflowOrchestrator] Auto-advance disabled by user preference',
      );
      return false;
    }

    // Check if there are pending clarifications
    if (state.pendingClarifications && state.pendingClarifications.length > 0) {
      console.log(
        '[WorkflowOrchestrator] Cannot auto-advance: pending clarifications',
      );
      return false;
    }

    // Check if current agent is in a state that allows advancement
    const currentAgent = state.currentAgent;
    if (!currentAgent) {
      console.log(
        '[WorkflowOrchestrator] Cannot auto-advance: no current agent',
      );
      return false;
    }

    const agentState = state.agentStates?.[currentAgent];
    if (
      agentState === 'waiting_for_clarification' ||
      agentState === 'running'
    ) {
      console.log(
        `[WorkflowOrchestrator] Cannot auto-advance: agent ${currentAgent} is ${agentState}`,
      );
      return false;
    }

    // Check if next step requires user input and respect user preferences
    const currentStepIndex = state.currentStepIndex || 0;
    const nextStep = state.workflowSteps?.[currentStepIndex + 1];

    if (nextStep?.userInputRequired) {
      if (userPrefs.autoAdvancePreference === 'ask') {
        console.log(
          '[WorkflowOrchestrator] Cannot auto-advance: next step requires input and user prefers to be asked',
        );
        return false;
      }
      // If preference is 'always', we can proceed even with user input required
    }

    // Check if next step is optional and user prefers to skip optional steps
    if (nextStep?.isOptional && userPrefs.skipOptionalSteps) {
      console.log(
        '[WorkflowOrchestrator] Can auto-advance: skipping optional step per user preference',
      );
      return true;
    }

    console.log('[WorkflowOrchestrator] Auto-advance conditions met');
    return true;
  }

  /**
   * Executes auto-advancement with AI-guided state transitions and timeout handling
   */
  async executeAutoAdvancement(
    chatId: string,
    modelId: string,
    dataStream?: UIMessageStreamWriter<ChatMessage>,
  ): Promise<void> {
    const canAdvance = await this.canAutoAdvance(chatId);
    if (!canAdvance) {
      throw new Error('Auto-advancement not possible in current state');
    }

    const state = await this.stateManager.getState(chatId);
    const userPrefs = state?.userPreferences || {};

    // Handle auto-advance timeout if user preference is 'ask'
    if (userPrefs.autoAdvancePreference === 'ask') {
      const timeoutMs = (userPrefs.timeoutForAutoAdvance || 30) * 1000;

      console.log(
        `[WorkflowOrchestrator] Auto-advance with ${timeoutMs / 1000}s timeout per user preference`,
      );

      // Notify user about pending auto-advancement
      if (dataStream) {
        dataStream.write({
          type: 'data-appendMessage',
          data: JSON.stringify({
            timeoutSeconds: userPrefs.timeoutForAutoAdvance || 30,
            message: `Auto-advancing in ${userPrefs.timeoutForAutoAdvance || 30} seconds. Click to proceed now or cancel.`,
            timestamp: new Date().toISOString(),
          }),
        });
      }

      // Wait for timeout (in real implementation, this would be handled by UI)
      // For now, we'll proceed immediately but log the timeout preference
      console.log(
        `[WorkflowOrchestrator] Would wait ${timeoutMs / 1000}s for user confirmation`,
      );
    }

    const nextAction = await this.determineNextAction(chatId, modelId);

    // Check if we should skip optional steps
    if (nextAction.type === 'advance_to_next' && userPrefs.skipOptionalSteps) {
      await this.handleOptionalStepSkipping(chatId, nextAction);
    }

    // Log the auto-advancement decision
    await this.stateManager.logStateTransition(chatId, {
      type: 'auto_advancement',
      from: 'waiting',
      to: nextAction.type,
      reason: nextAction.reason,
      timestamp: new Date().toISOString(),
      metadata: {
        confidence: nextAction.confidence,
        autoExecute: nextAction.autoExecute,
        userPreferences: userPrefs,
        timeoutUsed:
          userPrefs.autoAdvancePreference === 'ask'
            ? userPrefs.timeoutForAutoAdvance
            : undefined,
      },
    });

    // Execute the determined action
    switch (nextAction.type) {
      case 'continue_agent':
        if (nextAction.agentName) {
          await this.continueCurrentAgent(chatId, nextAction.agentName);
        }
        break;
      case 'advance_to_next':
        await this.advanceToNextStep(chatId);
        break;
      case 'complete_workflow':
        await this.completeWorkflow(chatId);
        break;
      case 'wait_for_input':
        // Generate user guidance for the waiting state with preference-aware verbosity
        if (dataStream) {
          const guidance = await this.generateUserGuidance(
            chatId,
            modelId,
            dataStream,
          );
          dataStream.write({
            type: 'data-appendMessage',
            data: JSON.stringify(guidance),
          });
        }
        break;
    }

    // Notify user of the advancement with preference-aware messaging
    if (dataStream && nextAction.userNotification) {
      const verbosity = userPrefs.verbosityLevel || 'normal';
      let notification = nextAction.userNotification;

      // Adjust notification detail based on verbosity preference
      if (verbosity === 'detailed') {
        notification += ` (Confidence: ${Math.round((nextAction.confidence || 0) * 100)}%, Auto-advance: ${userPrefs.autoAdvancePreference})`;
      } else if (verbosity === 'minimal') {
        // Keep only essential information
        notification = `${notification.split('.')[0]}.`;
      }

      dataStream.write({
        type: 'data-appendMessage',
        data: JSON.stringify({
          action: nextAction.type,
          notification,
          verbosity,
          timestamp: new Date().toISOString(),
        }),
      });
    }
  }

  /**
   * Generates AI-powered user guidance for current workflow state with preference-aware verbosity
   */
  async generateUserGuidance(
    chatId: string,
    modelId: string,
    dataStream?: UIMessageStreamWriter<ChatMessage>,
  ): Promise<WorkflowGuidance> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const userPrefs = state.userPreferences || {};
    const verbosity = userPrefs.verbosityLevel || 'normal';

    const guidance = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        currentPhase: z.enum([
          'planning',
          'design',
          'implementation',
          'completed',
        ]),
        phaseDescription: z.string(),
        progressPercentage: z.number().min(0).max(100),
        estimatedTimeRemaining: z.string().optional(),
        nextSteps: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            estimatedDuration: z.string(),
            requiresUserInput: z.boolean(),
            isOptional: z.boolean(),
          }),
        ),
        userActions: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            description: z.string(),
            type: z.enum(['continue', 'skip', 'restart', 'modify', 'help']),
            enabled: z.boolean(),
            consequences: z.string().optional(),
          }),
        ),
        canProceedAutomatically: z.boolean(),
        pendingRequirements: z.array(z.string()),
        helpfulTips: z.array(z.string()),
      }),
      prompt: `Generate user guidance for the current workflow state with ${verbosity} verbosity level:

Current Phase: ${state.currentPhase || 'unknown'}
Progress: ${state.workflowSteps?.filter((s) => s.status === 'completed').length || 0}/${state.workflowSteps?.length || 0} steps completed
Current Agent: ${state.currentAgent || 'none'}
Agent State: ${state.agentStates?.[state.currentAgent || ''] || 'unknown'}
Pending Clarifications: ${state.pendingClarifications?.length || 0}

User Preferences:
- Auto-advance: ${userPrefs.autoAdvancePreference || 'ask'}
- Verbosity: ${verbosity}
- Skip optional steps: ${userPrefs.skipOptionalSteps || false}
- Timeout: ${userPrefs.timeoutForAutoAdvance || 30}s

Workflow Steps:
${state.workflowSteps?.map((step, i) => `${i + 1}. ${step.name} (${step.status}) - Optional: ${step.isOptional}`).join('\n') || 'No steps defined'}

Verbosity Guidelines:
- minimal: Brief, essential information only. Short descriptions, fewer tips.
- normal: Balanced detail level. Standard explanations and helpful context.
- detailed: Comprehensive explanations. Include technical details, reasoning, and extensive tips.

Adapt the guidance content to match the user's preferred verbosity level:
- Phase description should be ${verbosity === 'minimal' ? 'brief' : verbosity === 'detailed' ? 'comprehensive with technical details' : 'balanced'}
- Next steps should be ${verbosity === 'minimal' ? 'concise' : verbosity === 'detailed' ? 'detailed with full context' : 'informative'}
- Helpful tips should be ${verbosity === 'minimal' ? '1-2 essential tips' : verbosity === 'detailed' ? '4-6 comprehensive tips' : '2-4 balanced tips'}

Consider user preferences for optional step handling and auto-advancement in the guidance.`,
    });

    let workflowGuidance: WorkflowGuidance = {
      ...guidance.object,
      lastUpdated: new Date().toISOString(),
    };

    // Filter guidance based on verbosity preference
    if (verbosity === 'minimal') {
      workflowGuidance = {
        ...workflowGuidance,
        nextSteps: workflowGuidance.nextSteps.slice(0, 2),
        userActions: workflowGuidance.userActions.slice(0, 3),
        helpfulTips: workflowGuidance.helpfulTips?.slice(0, 2) || [],
      };
    } else if (verbosity === 'detailed') {
      // Keep all content for detailed verbosity
      // Add additional context if needed
    } else {
      // Normal verbosity - moderate filtering
      workflowGuidance = {
        ...workflowGuidance,
        nextSteps: workflowGuidance.nextSteps.slice(0, 4),
        userActions: workflowGuidance.userActions.slice(0, 5),
        helpfulTips: workflowGuidance.helpfulTips?.slice(0, 3) || [],
      };
    }

    // Update state with generated guidance
    await this.stateManager.updateState(chatId, {
      lastGuidanceGenerated: workflowGuidance,
    });

    // Stream guidance to UI if dataStream provided
    if (dataStream) {
      dataStream.write({
        type: 'data-appendMessage',
        data: JSON.stringify(workflowGuidance),
      });
    }

    return workflowGuidance;
  }

  /**
   * Generates AI-powered next step options for user decision making
   */
  async generateNextStepOptions(
    chatId: string,
    modelId: string,
  ): Promise<UserAction[]> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const options = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        userActions: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            description: z.string(),
            type: z.enum(['continue', 'skip', 'restart', 'modify', 'help']),
            enabled: z.boolean(),
            consequences: z.string().optional(),
            estimatedTime: z.string().optional(),
            riskLevel: z.enum(['low', 'medium', 'high']).optional(),
          }),
        ),
        reasoning: z.string(),
      }),
      prompt: `Generate user action options for the current workflow state:

Current State: ${JSON.stringify({
        phase: state.currentPhase,
        agent: state.currentAgent,
        agentState: state.agentStates?.[state.currentAgent || ''],
        pendingClarifications: state.pendingClarifications?.length || 0,
        completedSteps:
          state.workflowSteps?.filter((s) => s.status === 'completed').length ||
          0,
        totalSteps: state.workflowSteps?.length || 0,
      })}

Consider what actions make sense in this context:
- Continue with current workflow
- Skip optional steps
- Restart from a previous point
- Modify previous answers or decisions
- Get help or explanations

Each action should be clearly labeled with consequences explained.`,
    });

    return options.object.userActions;
  }

  /**
   * Provides AI-generated explanation of the current workflow phase
   */
  async explainCurrentPhase(
    chatId: string,
    modelId: string,
  ): Promise<PhaseExplanation> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const explanation = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        phase: z.enum(['planning', 'design', 'implementation', 'completed']),
        title: z.string(),
        description: z.string(),
        objectives: z.array(z.string()),
        currentActivity: z.string(),
        whatHappensNext: z.string(),
        userRole: z.string(),
        estimatedDuration: z.string().optional(),
        keyMilestones: z.array(z.string()),
      }),
      prompt: `Explain the current workflow phase in detail:

Current Phase: ${state.currentPhase || 'unknown'}
Current Agent: ${state.currentAgent || 'none'}
Agent State: ${state.agentStates?.[state.currentAgent || ''] || 'unknown'}
Completed Steps: ${state.workflowSteps?.filter((s) => s.status === 'completed').length || 0}
Total Steps: ${state.workflowSteps?.length || 0}

Provide a comprehensive explanation that helps the user understand:
- What this phase is about and its objectives
- What's currently happening
- What will happen next
- What role the user plays
- Key milestones to expect`,
    });

    return explanation.object;
  }

  /**
   * Handle optional step skipping based on user preferences
   */
  private async handleOptionalStepSkipping(
    chatId: string,
    nextAction: WorkflowAction,
  ): Promise<void> {
    const state = await this.stateManager.getState(chatId);
    if (!state) return;

    const userPrefs = state.userPreferences || {};
    if (!userPrefs.skipOptionalSteps) return;

    const currentIndex = state.currentStepIndex || 0;
    let nextIndex = currentIndex + 1;

    // Skip consecutive optional steps
    while (
      state.workflowSteps &&
      nextIndex < state.workflowSteps.length &&
      state.workflowSteps[nextIndex].isOptional
    ) {
      const skippedStep = state.workflowSteps[nextIndex];

      console.log(
        `[WorkflowOrchestrator] Skipping optional step: ${skippedStep.name}`,
      );

      // Mark step as skipped
      skippedStep.status = 'skipped';
      skippedStep.skipReason = 'User preference: skip optional steps';

      // Log the skip
      await this.stateManager.logStateTransition(chatId, {
        type: 'step_skipped',
        from: 'pending',
        to: 'skipped',
        reason: `Skipped optional step ${skippedStep.name} per user preference`,
        timestamp: new Date().toISOString(),
        agentName: skippedStep.agentName,
        metadata: {
          stepId: skippedStep.id,
          stepName: skippedStep.name,
          skipReason: skippedStep.skipReason,
        },
      });

      nextIndex++;
    }

    // Update the current step index to the next non-optional step
    if (nextIndex !== currentIndex + 1) {
      await this.stateManager.updateState(chatId, {
        currentStepIndex: nextIndex - 1, // Will be incremented by advanceToNextStep
      });
    }
  }

  /**
   * Private helper methods for workflow execution
   */
  private async continueCurrentAgent(
    chatId: string,
    agentName: AgentName,
  ): Promise<void> {
    await this.stateManager.updateState(chatId, {
      agentStates: {
        ...((await this.stateManager.getState(chatId))?.agentStates || {}),
        [agentName]: 'running',
      },
    });
  }

  private async advanceToNextStep(chatId: string): Promise<void> {
    const state = await this.stateManager.getState(chatId);
    if (!state) return;

    const currentIndex = state.currentStepIndex || 0;
    const nextIndex = currentIndex + 1;

    if (state.workflowSteps && nextIndex < state.workflowSteps.length) {
      const nextStep = state.workflowSteps[nextIndex];

      // Check if this step should be skipped based on user preferences
      const userPrefs = state.userPreferences || {};
      if (nextStep.isOptional && userPrefs.skipOptionalSteps) {
        console.log(
          `[WorkflowOrchestrator] Auto-skipping optional step: ${nextStep.name}`,
        );
        nextStep.status = 'skipped';
        nextStep.skipReason = 'User preference: skip optional steps';

        // Recursively advance to next non-optional step
        await this.stateManager.updateState(chatId, {
          currentStepIndex: nextIndex,
        });

        return this.advanceToNextStep(chatId);
      }

      await this.stateManager.updateState(chatId, {
        currentStepIndex: nextIndex,
        currentAgent: nextStep.agentName,
        agentStates: {
          ...state.agentStates,
          [nextStep.agentName]: 'running',
        },
      });
    }
  }

  private async completeWorkflow(chatId: string): Promise<void> {
    await this.stateManager.updateState(chatId, {
      currentPhase: 'completed' as WorkflowPhase,
      workflowCompleted: true,
      completedAt: new Date().toISOString(),
    });
  }
}

/**
 * AI SDK V5 Tools for Workflow Orchestration
 */
export const createWorkflowOrchestrationTools = (
  chatId: string,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: string,
  orchestrator: WorkflowOrchestrator,
) => ({
  analyzeWorkflowState: tool({
    description:
      'Analyze current workflow state and determine optimal next action using AI',
    inputSchema: z.object({
      includeGuidance: z.boolean().default(true),
      includeTimeEstimates: z.boolean().default(true),
    }),
    execute: async ({ includeGuidance, includeTimeEstimates }) => {
      const nextAction = await orchestrator.determineNextAction(
        chatId,
        modelId,
      );

      let guidance: any;
      if (includeGuidance) {
        guidance = await orchestrator.generateUserGuidance(
          chatId,
          modelId,
          dataStream,
        );
      }

      return {
        nextAction,
        guidance: includeGuidance ? guidance : undefined,
        timestamp: new Date().toISOString(),
      };
    },
  }),

  executeAutoAdvancement: tool({
    description: 'Execute AI-guided auto-advancement if conditions are met',
    inputSchema: z.object({
      force: z.boolean().default(false),
    }),
    execute: async ({ force }) => {
      if (!force) {
        const canAdvance = await orchestrator.canAutoAdvance(chatId);
        if (!canAdvance) {
          return {
            executed: false,
            reason: 'Auto-advancement conditions not met',
          };
        }
      }

      await orchestrator.executeAutoAdvancement(chatId, modelId, dataStream);

      return {
        executed: true,
        timestamp: new Date().toISOString(),
      };
    },
  }),

  generateUserGuidance: tool({
    description:
      'Generate contextual user guidance using AI-powered explanations',
    inputSchema: z.object({
      includeNextSteps: z.boolean().default(true),
      includeUserActions: z.boolean().default(true),
      verbosity: z.enum(['minimal', 'normal', 'detailed']).default('normal'),
    }),
    execute: async ({ includeNextSteps, includeUserActions, verbosity }) => {
      const guidance = await orchestrator.generateUserGuidance(
        chatId,
        modelId,
        dataStream,
      );

      // Filter guidance based on verbosity level
      if (verbosity === 'minimal') {
        return {
          currentPhase: guidance.currentPhase,
          progressPercentage: guidance.progressPercentage,
          nextSteps: includeNextSteps ? guidance.nextSteps.slice(0, 2) : [],
          userActions: includeUserActions
            ? guidance.userActions.slice(0, 3)
            : [],
        };
      }

      return guidance;
    },
  }),

  explainCurrentPhase: tool({
    description: 'Get AI-generated explanation of the current workflow phase',
    inputSchema: z.object({}),
    execute: async () => {
      return await orchestrator.explainCurrentPhase(chatId, modelId);
    },
  }),
});
