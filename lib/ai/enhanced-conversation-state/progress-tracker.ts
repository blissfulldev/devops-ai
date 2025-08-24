import { generateObject, tool } from 'ai';
import { z } from 'zod';
import type { UIMessageStreamWriter } from 'ai/rsc';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import { myProvider } from '@/lib/ai/providers';
import type {
  EnhancedConversationState,
  WorkflowStep,
  ProgressInfo,
  WorkflowPhase,
  StepStatus,
} from './types';
import type { EnhancedStateManager } from './enhanced-state-manager';

/**
 * ProgressTracker provides comprehensive progress calculation and reporting
 * with AI-powered time estimation and milestone tracking
 */
export class ProgressTracker {
  private stateManager: EnhancedStateManager;

  constructor(stateManager: EnhancedStateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Calculate comprehensive progress information with phase and overall tracking
   */
  async calculateProgress(chatId: string): Promise<ProgressInfo> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const workflowSteps = state.workflowSteps || [];
    const totalSteps = workflowSteps.length;

    if (totalSteps === 0) {
      return {
        overallProgress: 0,
        currentPhase: state.currentPhase || 'planning',
        phaseProgress: 0,
        completedSteps: 0,
        totalSteps: 0,
        stepsRequiringInput: 0,
        stepsRemainingWithInput: 0,
      };
    }

    // Calculate step counts
    const completedSteps = workflowSteps.filter(
      (step) => step.status === 'completed',
    ).length;
    const skippedSteps = workflowSteps.filter(
      (step) => step.status === 'skipped',
    ).length;
    const failedSteps = workflowSteps.filter(
      (step) => step.status === 'failed',
    ).length;
    const activeSteps = workflowSteps.filter(
      (step) => step.status === 'active',
    ).length;
    const stepsRequiringInput = workflowSteps.filter(
      (step) => step.userInputRequired,
    ).length;
    const completedInputSteps = workflowSteps.filter(
      (step) =>
        step.userInputRequired &&
        (step.status === 'completed' || step.status === 'skipped'),
    ).length;

    // Calculate overall progress (completed + skipped steps count as progress)
    const progressSteps = completedSteps + skippedSteps;
    const overallProgress = Math.round((progressSteps / totalSteps) * 100);

    // Calculate phase-specific progress
    const phaseProgress = this.calculatePhaseProgress(
      state.currentPhase || 'planning',
      workflowSteps,
    );

    return {
      overallProgress,
      currentPhase: state.currentPhase || 'planning',
      phaseProgress,
      completedSteps: progressSteps,
      totalSteps,
      stepsRequiringInput,
      stepsRemainingWithInput: stepsRequiringInput - completedInputSteps,
      activeSteps,
      failedSteps,
      estimatedCompletionTime: await this.calculateEstimatedCompletion(chatId),
    };
  }

  /**
   * Calculate phase-specific progress with weighted calculations
   */
  private calculatePhaseProgress(
    currentPhase: WorkflowPhase,
    workflowSteps: WorkflowStep[],
  ): number {
    // Define phase boundaries based on step types/agents
    const phaseStepMapping: Record<WorkflowPhase, string[]> = {
      planning: ['core_agent'],
      design: ['diagram_agent'],
      implementation: ['terraform_agent'],
      completed: [],
    };

    const phaseAgents = phaseStepMapping[currentPhase] || [];
    if (phaseAgents.length === 0) return 100; // Completed phase

    const phaseSteps = workflowSteps.filter((step) =>
      phaseAgents.includes(step.agentName),
    );

    if (phaseSteps.length === 0) return 0;

    const completedPhaseSteps = phaseSteps.filter(
      (step) => step.status === 'completed' || step.status === 'skipped',
    ).length;

    return Math.round((completedPhaseSteps / phaseSteps.length) * 100);
  }

  /**
   * Calculate estimated completion time based on remaining work
   */
  private async calculateEstimatedCompletion(chatId: string): Promise<string> {
    const state = await this.stateManager.getState(chatId);
    if (!state) return 'Unknown';

    const remainingSteps =
      state.workflowSteps?.filter(
        (step) => step.status === 'pending' || step.status === 'active',
      ) || [];

    if (remainingSteps.length === 0) return 'Complete';

    // Sum estimated durations for remaining steps
    const totalEstimatedSeconds = remainingSteps.reduce(
      (total, step) => total + step.estimatedDuration,
      0,
    );

    // Add buffer for clarifications based on historical data
    const clarificationBuffer = this.calculateClarificationBuffer(state);
    const totalWithBuffer = totalEstimatedSeconds + clarificationBuffer;

    return this.formatDuration(totalWithBuffer);
  }

  /**
   * Calculate buffer time for clarifications based on historical data
   */
  private calculateClarificationBuffer(
    state: EnhancedConversationState,
  ): number {
    const metrics = state.performanceMetrics;
    if (!metrics || metrics.totalQuestions === 0) {
      return 300; // Default 5-minute buffer
    }

    // Estimate based on average response time and question frequency
    const avgResponseTime = metrics.averageResponseTime || 60;
    const questionRate =
      metrics.totalQuestions / Math.max(1, metrics.totalQuestions);

    return Math.round(avgResponseTime * questionRate * 2); // 2x buffer
  }

  /**
   * Format duration in seconds to human-readable string
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);

    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }

  /**
   * Generate comprehensive progress summary for user display
   */
  async generateProgressSummary(
    chatId: string,
    modelId: ChatModel['id'],
  ): Promise<{
    summary: string;
    milestones: {
      completed: string[];
      upcoming: string[];
      current: string;
    };
    insights: string[];
    recommendations: string[];
    timeBreakdown: {
      completed: string;
      remaining: string;
      total: string;
    };
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const progressInfo = await this.calculateProgress(chatId);

    const summary = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        summary: z.string(),
        milestones: z.object({
          completed: z.array(z.string()),
          upcoming: z.array(z.string()),
          current: z.string(),
        }),
        insights: z.array(z.string()),
        recommendations: z.array(z.string()),
        timeBreakdown: z.object({
          completed: z.string(),
          remaining: z.string(),
          total: z.string(),
        }),
      }),
      prompt: `Generate a comprehensive progress summary for the current workflow:

Progress Analysis:
- Overall Progress: ${progressInfo.overallProgress}%
- Current Phase: ${progressInfo.currentPhase}
- Phase Progress: ${progressInfo.phaseProgress}%
- Completed Steps: ${progressInfo.completedSteps}/${progressInfo.totalSteps}
- Steps Requiring Input: ${progressInfo.stepsRequiringInput}
- Remaining Input Steps: ${progressInfo.stepsRemainingWithInput}

Workflow Steps Detail:
${
  state.workflowSteps
    ?.map(
      (step, i) =>
        `${i + 1}. ${step.name} (${step.status}) - Agent: ${step.agentName}, Duration: ${step.estimatedDuration}s`,
    )
    .join('\n') || 'No steps defined'
}

Performance Metrics:
- Total Questions: ${state.performanceMetrics?.totalQuestions || 0}
- Questions Reused: ${state.performanceMetrics?.questionsReused || 0}
- Error Count: ${state.performanceMetrics?.errorCount || 0}
- Avg Response Time: ${state.performanceMetrics?.averageResponseTime || 0}s

Current Agent State: ${state.currentAgent ? `${state.currentAgent} (${state.agentStates?.[state.currentAgent] || 'unknown'})` : 'None'}

Generate:
- A clear, encouraging summary of current progress
- Key milestones that have been completed
- Important upcoming milestones to expect
- Current milestone or focus area
- Actionable insights about the workflow progress
- Specific recommendations for improvement or next steps
- Time breakdown showing completed vs remaining work

Be positive and constructive while being realistic about progress and challenges.`,
      system: `You are an expert project manager providing progress updates. 
      Be encouraging while being honest about progress and realistic about timelines.
      Focus on actionable insights and helpful recommendations.`,
    });

    return summary.object;
  }

  /**
   * Track milestone completion and generate notifications
   */
  async trackMilestones(
    chatId: string,
    modelId: ChatModel['id'],
  ): Promise<{
    newMilestones: string[];
    notifications: string[];
    celebrationMessages: string[];
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const milestones = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        newMilestones: z.array(z.string()),
        notifications: z.array(z.string()),
        celebrationMessages: z.array(z.string()),
      }),
      prompt: `Analyze workflow progress and identify milestone achievements:

Current Workflow State:
- Phase: ${state.currentPhase || 'unknown'}
- Completed Steps: ${state.workflowSteps?.filter((s) => s.status === 'completed').length || 0}
- Total Steps: ${state.workflowSteps?.length || 0}
- Current Agent: ${state.currentAgent || 'none'}

Recent Step Completions:
${
  state.workflowSteps
    ?.filter((s) => s.status === 'completed' && s.endTime)
    .slice(-3)
    .map((step) => `- ${step.name} completed at ${step.endTime}`)
    .join('\n') || 'No recent completions'
}

Performance Achievements:
- Questions Reused: ${state.performanceMetrics?.questionsReused || 0}
- Error Rate: ${(state.performanceMetrics?.errorCount || 0) === 0 ? 'Zero errors!' : `${state.performanceMetrics?.errorCount} errors`}

Identify:
- New milestones that have been reached (phase completions, major step completions, etc.)
- Important notifications about progress achievements
- Celebration messages for significant accomplishments

Focus on meaningful achievements that represent real progress toward the goal.`,
      system: `You are an expert at recognizing and celebrating project milestones.
      Identify genuine achievements that deserve recognition while maintaining appropriate enthusiasm.`,
    });

    return milestones.object;
  }

  /**
   * Generate progress visualization data for UI consumption
   */
  async generateProgressVisualization(chatId: string): Promise<{
    overallProgress: number;
    phaseProgress: Record<WorkflowPhase, number>;
    stepProgress: Array<{
      id: string;
      name: string;
      status: StepStatus;
      progress: number;
      estimatedDuration: number;
      actualDuration?: number;
    }>;
    timeline: Array<{
      timestamp: string;
      event: string;
      type: 'milestone' | 'step_completion' | 'phase_change' | 'error';
    }>;
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const progressInfo = await this.calculateProgress(chatId);

    // Calculate phase progress for all phases
    const phaseProgress: Record<WorkflowPhase, number> = {
      planning: this.calculatePhaseProgress(
        'planning',
        state.workflowSteps || [],
      ),
      design: this.calculatePhaseProgress('design', state.workflowSteps || []),
      implementation: this.calculatePhaseProgress(
        'implementation',
        state.workflowSteps || [],
      ),
      completed: state.currentPhase === 'completed' ? 100 : 0,
    };

    // Generate step progress data
    const stepProgress = (state.workflowSteps || []).map((step) => {
      let progress = 0;
      switch (step.status) {
        case 'completed':
        case 'skipped':
          progress = 100;
          break;
        case 'active':
          progress = 50; // Assume 50% for active steps
          break;
        case 'failed':
          progress = 25; // Some progress made before failure
          break;
        default:
          progress = 0;
      }

      const actualDuration =
        step.startTime && step.endTime
          ? Math.round(
              (new Date(step.endTime).getTime() -
                new Date(step.startTime).getTime()) /
                1000,
            )
          : undefined;

      return {
        id: step.id,
        name: step.name,
        status: step.status,
        progress,
        estimatedDuration: step.estimatedDuration,
        actualDuration,
      };
    });

    // Generate timeline from state transitions
    const timeline = (state.stateTransitionLog || [])
      .slice(-20) // Last 20 events
      .map((transition) => ({
        timestamp: transition.timestamp,
        event: transition.reason,
        type: this.categorizeTransition(transition.type),
      }));

    return {
      overallProgress: progressInfo.overallProgress,
      phaseProgress,
      stepProgress,
      timeline,
    };
  }

  /**
   * Categorize state transitions for timeline visualization
   */
  private categorizeTransition(
    transitionType: string,
  ): 'milestone' | 'step_completion' | 'phase_change' | 'error' {
    if (transitionType.includes('error') || transitionType.includes('failed')) {
      return 'error';
    }
    if (
      transitionType.includes('phase') ||
      transitionType.includes('complete_workflow')
    ) {
      return 'phase_change';
    }
    if (transitionType.includes('step') || transitionType.includes('agent')) {
      return 'step_completion';
    }
    return 'milestone';
  }

  /**
   * Calculate performance metrics and trends
   */
  async calculatePerformanceMetrics(chatId: string): Promise<{
    efficiency: {
      questionReuseRate: number;
      errorRate: number;
      averageStepDuration: number;
      timeVariance: number;
    };
    trends: {
      progressVelocity: number; // steps per hour
      clarificationFrequency: number;
      errorTrend: 'improving' | 'stable' | 'worsening';
    };
    predictions: {
      estimatedCompletion: string;
      confidence: number;
      riskFactors: string[];
    };
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const metrics = state.performanceMetrics || {
      totalQuestions: 0,
      questionsReused: 0,
      averageResponseTime: 0,
      workflowCompletionRate: 0,
      errorCount: 0,
      lastUpdated: new Date().toISOString(),
    };

    const completedSteps =
      state.workflowSteps?.filter((s) => s.status === 'completed') || [];
    const totalSteps = state.workflowSteps?.length || 1;

    // Calculate efficiency metrics
    const questionReuseRate =
      metrics.totalQuestions > 0
        ? Math.round((metrics.questionsReused / metrics.totalQuestions) * 100)
        : 0;

    const errorRate =
      totalSteps > 0 ? Math.round((metrics.errorCount / totalSteps) * 100) : 0;

    const stepDurations = completedSteps
      .filter((step) => step.startTime && step.endTime)
      .map((step) => {
        const start = step.startTime ? new Date(step.startTime).getTime() : 0;
        const end = step.endTime ? new Date(step.endTime).getTime() : 0;
        return (end - start) / 1000; // Convert to seconds
      });

    const averageStepDuration =
      stepDurations.length > 0
        ? Math.round(
            stepDurations.reduce((sum, duration) => sum + duration, 0) /
              stepDurations.length,
          )
        : 0;

    // Calculate time variance (standard deviation)
    const timeVariance =
      stepDurations.length > 1
        ? Math.round(
            Math.sqrt(
              stepDurations.reduce(
                (sum, duration) =>
                  sum + Math.pow(duration - averageStepDuration, 2),
                0,
              ) / stepDurations.length,
            ),
          )
        : 0;

    // Calculate trends (simplified for now)
    const progressVelocity =
      completedSteps.length > 0 ? completedSteps.length / 1 : 0; // steps per hour (simplified)
    const clarificationFrequency =
      metrics.totalQuestions / Math.max(1, completedSteps.length);
    const errorTrend: 'improving' | 'stable' | 'worsening' =
      metrics.errorCount === 0
        ? 'stable'
        : metrics.errorCount < 3
          ? 'improving'
          : 'worsening';

    // Generate predictions
    const remainingSteps =
      state.workflowSteps?.filter(
        (s) => s.status === 'pending' || s.status === 'active',
      ).length || 0;

    const estimatedSeconds = remainingSteps * averageStepDuration;
    const estimatedCompletion = this.formatDuration(estimatedSeconds);

    const confidence = Math.max(
      0.3,
      Math.min(
        0.95,
        (completedSteps.length / totalSteps) * 0.8 +
          (questionReuseRate / 100) * 0.2,
      ),
    );

    const riskFactors: string[] = [];
    if (errorRate > 10) riskFactors.push('High error rate');
    if (timeVariance > averageStepDuration * 0.5)
      riskFactors.push('High time variance');
    if (clarificationFrequency > 2)
      riskFactors.push('Frequent clarifications needed');

    return {
      efficiency: {
        questionReuseRate,
        errorRate,
        averageStepDuration,
        timeVariance,
      },
      trends: {
        progressVelocity,
        clarificationFrequency,
        errorTrend,
      },
      predictions: {
        estimatedCompletion,
        confidence,
        riskFactors,
      },
    };
  }
}

/**
 * AI SDK V5 Tools for Progress Tracking
 */
export const createProgressTrackingTools = (
  chatId: string,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
  progressTracker: ProgressTracker,
) => ({
  calculateProgress: tool({
    description:
      'Calculate comprehensive progress information with phase tracking',
    inputSchema: z.object({
      includeEstimates: z.boolean().default(true),
      includePhaseBreakdown: z.boolean().default(true),
    }),
    execute: async ({ includeEstimates, includePhaseBreakdown }) => {
      const progress = await progressTracker.calculateProgress(chatId);

      // Stream progress update to UI
      dataStream.write({
        type: 'data-progressUpdate',
        data: progress,
        transient: false,
      });

      return progress;
    },
  }),

  generateProgressSummary: tool({
    description: 'Generate comprehensive progress summary with insights',
    inputSchema: z.object({
      includeRecommendations: z.boolean().default(true),
      verbosity: z.enum(['brief', 'detailed']).default('detailed'),
    }),
    execute: async ({ includeRecommendations, verbosity }) => {
      const summary = await progressTracker.generateProgressSummary(
        chatId,
        modelId,
      );

      // Filter based on verbosity
      if (verbosity === 'brief') {
        return {
          summary: summary.summary,
          current: summary.milestones.current,
          timeRemaining: summary.timeBreakdown.remaining,
          topRecommendation: summary.recommendations[0],
        };
      }

      return summary;
    },
  }),

  trackMilestones: tool({
    description: 'Track milestone completion and generate celebration messages',
    inputSchema: z.object({}),
    execute: async () => {
      const milestones = await progressTracker.trackMilestones(chatId, modelId);

      // Stream milestone achievements to UI
      if (milestones.newMilestones.length > 0) {
        dataStream.write({
          type: 'data-milestoneAchieved',
          data: milestones,
          transient: false,
        });
      }

      return milestones;
    },
  }),

  generateProgressVisualization: tool({
    description: 'Generate progress visualization data for UI consumption',
    inputSchema: z.object({
      includeTimeline: z.boolean().default(true),
      maxTimelineEvents: z.number().default(20),
    }),
    execute: async ({ includeTimeline, maxTimelineEvents }) => {
      const visualization =
        await progressTracker.generateProgressVisualization(chatId);

      if (!includeTimeline) {
        visualization.timeline = undefined;
      } else if (visualization.timeline.length > maxTimelineEvents) {
        visualization.timeline = visualization.timeline.slice(
          -maxTimelineEvents,
        );
      }

      return visualization;
    },
  }),

  calculatePerformanceMetrics: tool({
    description: 'Calculate performance metrics and trends with predictions',
    inputSchema: z.object({
      includePredictions: z.boolean().default(true),
      includeTrends: z.boolean().default(true),
    }),
    execute: async ({ includePredictions, includeTrends }) => {
      const metrics = await progressTracker.calculatePerformanceMetrics(chatId);

      const result: any = {
        efficiency: metrics.efficiency,
      };

      if (includeTrends) {
        result.trends = metrics.trends;
      }

      if (includePredictions) {
        result.predictions = metrics.predictions;
      }

      return result;
    },
  }),
});
