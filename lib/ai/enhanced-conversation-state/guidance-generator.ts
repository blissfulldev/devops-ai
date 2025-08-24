import { generateObject, tool } from 'ai';
import { z } from 'zod';
import type { UIMessageStreamWriter } from 'ai/rsc';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import { myProvider } from '@/lib/ai/providers';
import type { WorkflowGuidance, UserAction } from './types';
import type { EnhancedStateManager } from './enhanced-state-manager';

/**
 * GuidanceGenerator creates AI-powered contextual help and user guidance
 * that adapts to user experience level and workflow context
 */
export class GuidanceGenerator {
  private stateManager: EnhancedStateManager;

  constructor(stateManager: EnhancedStateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Generate comprehensive user guidance using AI SDK V5 generateObject
   */
  async generateUserGuidance(
    chatId: string,
    modelId: ChatModel['id'],
    dataStream?: UIMessageStreamWriter<ChatMessage>,
  ): Promise<WorkflowGuidance> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const userPrefs = state.userPreferences || {};
    const completedSteps =
      state.workflowSteps?.filter((s) => s.status === 'completed').length || 0;
    const totalSteps = state.workflowSteps?.length || 0;
    const progressPercentage =
      totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

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
            estimatedTime: z.string().optional(),
            riskLevel: z.enum(['low', 'medium', 'high']).optional(),
          }),
        ),
        canProceedAutomatically: z.boolean(),
        pendingRequirements: z.array(z.string()),
        helpfulTips: z.array(z.string()),
      }),
      prompt: `Generate comprehensive user guidance for the current workflow state:

Current Context:
- Phase: ${state.currentPhase || 'unknown'}
- Progress: ${completedSteps}/${totalSteps} steps completed (${progressPercentage}%)
- Current Agent: ${state.currentAgent || 'none'}
- Agent State: ${state.agentStates?.[state.currentAgent || ''] || 'unknown'}
- Pending Clarifications: ${state.pendingClarifications?.length || 0}
- User Experience Level: ${userPrefs.verbosityLevel || 'normal'}
- Auto-advance Preference: ${userPrefs.autoAdvancePreference || 'ask'}

Workflow Steps Status:
${
  state.workflowSteps
    ?.map(
      (step, i) =>
        `${i + 1}. ${step.name} (${step.status}) - ${step.description}`,
    )
    .join('\n') || 'No steps defined'
}

User Preferences:
- Verbosity: ${userPrefs.verbosityLevel || 'normal'}
- Auto-advance: ${userPrefs.autoAdvancePreference || 'ask'}
- Skip optional steps: ${userPrefs.skipOptionalSteps || false}

Generate guidance that:
- Explains the current phase clearly and what's happening
- Provides accurate progress information
- Lists realistic next steps with time estimates
- Offers relevant user actions with clear consequences
- Includes helpful tips appropriate for the user's experience level
- Indicates whether auto-advancement is possible
- Adapts to user preferences for verbosity and control`,
      system: `You are an expert at providing clear, helpful guidance to users navigating complex workflows. 
      Adapt your language and detail level to the user's experience and preferences. 
      Be encouraging and informative while being concise when appropriate.`,
    });

    const workflowGuidance: WorkflowGuidance = {
      ...guidance.object,
      lastUpdated: new Date().toISOString(),
    };

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
   * Generate intelligent next step options based on current workflow state
   */
  async generateNextStepOptions(
    chatId: string,
    modelId: ChatModel['id'],
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

Current State Analysis:
- Phase: ${state.currentPhase || 'unknown'}
- Current Agent: ${state.currentAgent || 'none'}
- Agent State: ${state.agentStates?.[state.currentAgent || ''] || 'unknown'}
- Pending Clarifications: ${state.pendingClarifications?.length || 0}
- Completed Steps: ${state.workflowSteps?.filter((s) => s.status === 'completed').length || 0}
- Total Steps: ${state.workflowSteps?.length || 0}
- User Preferences: ${JSON.stringify(state.userPreferences || {})}

Available Workflow Steps:
${
  state.workflowSteps
    ?.map(
      (step, i) =>
        `${i + 1}. ${step.name} (${step.status}) - Optional: ${step.isOptional}`,
    )
    .join('\n') || 'No steps defined'
}

Generate appropriate user actions considering:
- Continue with current workflow progression
- Skip optional steps (with clear consequences)
- Restart from a previous point or phase
- Modify previous answers or decisions
- Get help or detailed explanations
- Handle error states or blocked conditions

Each action should:
- Have a clear, actionable label
- Include a helpful description
- Specify consequences if applicable
- Indicate time impact
- Show risk level for potentially disruptive actions
- Be enabled/disabled based on current state`,
      system: `You are an expert at workflow management and user experience. 
      Provide actions that give users appropriate control while preventing destructive operations.
      Consider the user's experience level and current workflow state.`,
    });

    return options.object.userActions;
  }

  /**
   * Generate contextual help that adapts to user experience level
   */
  async generateContextualHelp(
    chatId: string,
    modelId: ChatModel['id'],
    topic?: string,
    userLevel: 'beginner' | 'intermediate' | 'advanced' = 'intermediate',
  ): Promise<{
    explanation: string;
    examples: string[];
    relatedConcepts: string[];
    troubleshooting: string[];
    nextSteps: string[];
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const help = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        explanation: z.string(),
        examples: z.array(z.string()),
        relatedConcepts: z.array(z.string()),
        troubleshooting: z.array(z.string()),
        nextSteps: z.array(z.string()),
      }),
      prompt: `Generate contextual help for a ${userLevel} user about: ${topic || 'current workflow state'}

Current Workflow Context:
- Phase: ${state.currentPhase || 'unknown'}
- Current Agent: ${state.currentAgent || 'none'}
- Agent State: ${state.agentStates?.[state.currentAgent || ''] || 'unknown'}
- Recent Activity: ${state.workflowSteps?.find((s) => s.status === 'active')?.description || 'No active step'}

User Level: ${userLevel}
- Beginner: Provide detailed explanations, avoid jargon, include basic concepts
- Intermediate: Balance detail with efficiency, some technical terms OK
- Advanced: Concise, technical explanations, focus on advanced concepts

Generate help that includes:
- Clear explanation appropriate for user level
- Practical examples relevant to current context
- Related concepts they should understand
- Common troubleshooting scenarios
- Suggested next steps or actions

Adapt language complexity and detail level to the user's experience.`,
      system: `You are an expert technical writer and educator. 
      Provide helpful, accurate information that matches the user's experience level.
      Be practical and actionable while being appropriately detailed.`,
    });

    return help.object;
  }

  /**
   * Generate progress summary with insights and recommendations
   */
  async generateProgressSummary(
    chatId: string,
    modelId: ChatModel['id'],
  ): Promise<{
    overallStatus: string;
    completedMilestones: string[];
    upcomingMilestones: string[];
    blockers: string[];
    recommendations: string[];
    timeEstimate: string;
    confidence: number;
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const summary = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        overallStatus: z.string(),
        completedMilestones: z.array(z.string()),
        upcomingMilestones: z.array(z.string()),
        blockers: z.array(z.string()),
        recommendations: z.array(z.string()),
        timeEstimate: z.string(),
        confidence: z.number().min(0).max(1),
      }),
      prompt: `Generate a comprehensive progress summary for the current workflow:

Workflow Analysis:
- Phase: ${state.currentPhase || 'unknown'}
- Overall Progress: ${state.workflowSteps?.filter((s) => s.status === 'completed').length || 0}/${state.workflowSteps?.length || 0} steps
- Current Agent: ${state.currentAgent || 'none'}
- Agent State: ${state.agentStates?.[state.currentAgent || ''] || 'unknown'}
- Pending Clarifications: ${state.pendingClarifications?.length || 0}

Step Details:
${
  state.workflowSteps
    ?.map(
      (step, i) =>
        `${i + 1}. ${step.name} (${step.status}) - Duration: ${step.estimatedDuration}s, Required: ${!step.isOptional}`,
    )
    .join('\n') || 'No steps defined'
}

Performance Metrics:
- Total Questions: ${state.performanceMetrics?.totalQuestions || 0}
- Questions Reused: ${state.performanceMetrics?.questionsReused || 0}
- Error Count: ${state.performanceMetrics?.errorCount || 0}

Analyze and provide:
- Overall status assessment (on track, delayed, blocked, etc.)
- Key milestones that have been completed
- Important upcoming milestones
- Current blockers or impediments
- Actionable recommendations for improvement
- Realistic time estimate for completion
- Confidence level in the estimate (0-1)

Be honest about challenges while remaining constructive and solution-focused.`,
      system: `You are an expert project manager and analyst. 
      Provide accurate, actionable insights that help users understand their progress and next steps.
      Be realistic about timelines and challenges while maintaining a positive, solution-oriented tone.`,
    });

    return summary.object;
  }

  /**
   * Generate adaptive guidance based on user patterns and preferences
   */
  async generateAdaptiveGuidance(
    chatId: string,
    modelId: ChatModel['id'],
    userContext: {
      experienceLevel?: 'beginner' | 'intermediate' | 'advanced';
      previousInteractions?: number;
      preferredStyle?: 'detailed' | 'concise' | 'visual';
      commonQuestions?: string[];
    } = {},
  ): Promise<WorkflowGuidance> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

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
        personalizedInsights: z.array(z.string()),
      }),
      prompt: `Generate personalized user guidance adapted to user patterns and preferences:

Current Workflow State:
- Phase: ${state.currentPhase || 'unknown'}
- Progress: ${state.workflowSteps?.filter((s) => s.status === 'completed').length || 0}/${state.workflowSteps?.length || 0} steps
- Current Agent: ${state.currentAgent || 'none'}
- Pending Clarifications: ${state.pendingClarifications?.length || 0}

User Context:
- Experience Level: ${userContext.experienceLevel || 'intermediate'}
- Previous Interactions: ${userContext.previousInteractions || 0}
- Preferred Style: ${userContext.preferredStyle || 'balanced'}
- Common Questions: ${userContext.commonQuestions?.join(', ') || 'none identified'}

User Preferences:
- Verbosity: ${state.userPreferences?.verbosityLevel || 'normal'}
- Auto-advance: ${state.userPreferences?.autoAdvancePreference || 'ask'}
- Skip Optional: ${state.userPreferences?.skipOptionalSteps || false}

Historical Performance:
- Questions Reused: ${state.performanceMetrics?.questionsReused || 0}/${state.performanceMetrics?.totalQuestions || 0}
- Error Rate: ${state.performanceMetrics?.errorCount || 0} errors

Adapt the guidance to:
- Match the user's experience level and learning style
- Address their common questions proactively
- Reflect their interaction patterns and preferences
- Provide personalized insights based on their workflow history
- Suggest optimizations based on their usage patterns

Include personalized insights that help them work more effectively.`,
      system: `You are an expert at personalized user experience and adaptive interfaces. 
      Create guidance that feels tailored to the individual user while remaining helpful and actionable.
      Use their patterns and preferences to provide more relevant and effective assistance.`,
    });

    const adaptiveGuidance: WorkflowGuidance = {
      ...guidance.object,
      lastUpdated: new Date().toISOString(),
    };

    // Update state with generated guidance
    await this.stateManager.updateState(chatId, {
      lastGuidanceGenerated: adaptiveGuidance,
    });

    return adaptiveGuidance;
  }
}

/**
 * AI SDK V5 Tools for User Guidance Generation
 */
export const createUserGuidanceTools = (
  chatId: string,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
  guidanceGenerator: GuidanceGenerator,
) => ({
  generateUserGuidance: tool({
    description: 'Generate comprehensive contextual user guidance',
    inputSchema: z.object({
      includeNextSteps: z.boolean().default(true),
      includeUserActions: z.boolean().default(true),
      verbosity: z.enum(['minimal', 'normal', 'detailed']).default('normal'),
    }),
    execute: async ({ includeNextSteps, includeUserActions, verbosity }) => {
      const guidance = await guidanceGenerator.generateUserGuidance(
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
          helpfulTips: guidance.helpfulTips?.slice(0, 2) || [],
        };
      } else if (verbosity === 'detailed') {
        return guidance;
      }

      // Normal verbosity - return most fields but limit arrays
      return {
        ...guidance,
        nextSteps: includeNextSteps ? guidance.nextSteps.slice(0, 4) : [],
        userActions: includeUserActions ? guidance.userActions.slice(0, 5) : [],
        helpfulTips: guidance.helpfulTips?.slice(0, 3) || [],
      };
    },
  }),

  generateNextStepOptions: tool({
    description:
      'Generate intelligent next step options for user decision making',
    inputSchema: z.object({
      maxOptions: z.number().default(5),
      includeRiskyActions: z.boolean().default(false),
    }),
    execute: async ({ maxOptions, includeRiskyActions }) => {
      const options = await guidanceGenerator.generateNextStepOptions(
        chatId,
        modelId,
      );

      let filteredOptions = options;
      if (!includeRiskyActions) {
        filteredOptions = options.filter(
          (action) => action.riskLevel !== 'high',
        );
      }

      return {
        userActions: filteredOptions.slice(0, maxOptions),
        timestamp: new Date().toISOString(),
      };
    },
  }),

  generateContextualHelp: tool({
    description: 'Generate contextual help adapted to user experience level',
    inputSchema: z.object({
      topic: z.string().optional(),
      userLevel: z
        .enum(['beginner', 'intermediate', 'advanced'])
        .default('intermediate'),
    }),
    execute: async ({ topic, userLevel }) => {
      return await guidanceGenerator.generateContextualHelp(
        chatId,
        modelId,
        topic,
        userLevel,
      );
    },
  }),

  generateProgressSummary: tool({
    description: 'Generate comprehensive progress summary with insights',
    inputSchema: z.object({}),
    execute: async () => {
      return await guidanceGenerator.generateProgressSummary(chatId, modelId);
    },
  }),

  generateAdaptiveGuidance: tool({
    description: 'Generate guidance adapted to user patterns and preferences',
    inputSchema: z.object({
      userContext: z
        .object({
          experienceLevel: z
            .enum(['beginner', 'intermediate', 'advanced'])
            .optional(),
          previousInteractions: z.number().optional(),
          preferredStyle: z.enum(['detailed', 'concise', 'visual']).optional(),
          commonQuestions: z.array(z.string()).optional(),
        })
        .optional(),
    }),
    execute: async ({ userContext = {} }) => {
      const guidance = await guidanceGenerator.generateAdaptiveGuidance(
        chatId,
        modelId,
        userContext,
      );

      // Stream adaptive guidance to UI
      dataStream.write({
        type: 'data-appendMessage',
        data: JSON.stringify(guidance),
      });

      return guidance;
    },
  }),
});
