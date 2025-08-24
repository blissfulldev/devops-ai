import { generateObject, tool } from 'ai';
import { z } from 'zod';
import type { UIMessageStreamWriter } from 'ai';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import { myProvider } from '@/lib/ai/providers';
import type { EnhancedConversationState } from './types';
import type { WorkflowPhase } from '../conversation-state';
import type { EnhancedStateManager } from './enhanced-state-manager';
import type { ProgressTracker } from './progress-tracker';
import type { TimeEstimator } from './time-estimator';

/**
 * Comprehensive progress summary with all relevant information
 */
interface ComprehensiveProgressSummary {
  overview: {
    status: string;
    overallProgress: number;
    currentPhase: WorkflowPhase;
    phaseProgress: number;
    estimatedCompletion: string;
    confidence: number;
  };
  milestones: {
    completed: Array<{
      name: string;
      completedAt: string;
      duration: string;
    }>;
    current: {
      name: string;
      progress: number;
      estimatedCompletion: string;
    };
    upcoming: Array<{
      name: string;
      estimatedStart: string;
      estimatedDuration: string;
      dependencies: string[];
    }>;
  };
  performance: {
    efficiency: {
      questionReuseRate: number;
      errorRate: number;
      averageStepDuration: string;
    };
    trends: {
      progressVelocity: string;
      timeAccuracy: number;
      userEngagement: string;
    };
  };
  insights: {
    achievements: string[];
    challenges: string[];
    recommendations: string[];
    riskFactors: string[];
  };
  visualization: {
    progressChart: Array<{
      phase: string;
      progress: number;
      status: 'completed' | 'active' | 'pending';
    }>;
    timeline: Array<{
      timestamp: string;
      event: string;
      type: 'milestone' | 'completion' | 'issue';
    }>;
  };
}

/**
 * ProgressSummaryGenerator creates comprehensive progress summaries
 * combining progress tracking, time estimation, and milestone tracking
 */
export class ProgressSummaryGenerator {
  private stateManager: EnhancedStateManager;
  private progressTracker: ProgressTracker;
  private timeEstimator: TimeEstimator;

  constructor(
    stateManager: EnhancedStateManager,
    progressTracker: ProgressTracker,
    timeEstimator: TimeEstimator,
  ) {
    this.stateManager = stateManager;
    this.progressTracker = progressTracker;
    this.timeEstimator = timeEstimator;
  }

  /**
   * Generate comprehensive progress summary with all components
   */
  async generateProgressSummary(
    chatId: string,
    modelId: ChatModel['id'],
    options: {
      includeVisualization?: boolean;
      includePerformanceMetrics?: boolean;
      includeRecommendations?: boolean;
      verbosity?: 'brief' | 'standard' | 'detailed';
    } = {},
  ): Promise<ComprehensiveProgressSummary> {
    const {
      includeVisualization = true,
      includePerformanceMetrics = true,
      verbosity = 'standard',
    } = options;

    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    // Gather all necessary data
    const progressInfo = await this.progressTracker.calculateProgress(chatId);
    const timeEstimate = await this.timeEstimator.estimateTimeRemaining(
      chatId,
      modelId,
    );
    const milestones = await this.progressTracker.trackMilestones(
      chatId,
      modelId,
    );

    let performanceMetrics: any;
    if (includePerformanceMetrics) {
      performanceMetrics =
        await this.progressTracker.calculatePerformanceMetrics(chatId);
    }

    let visualization: any;
    if (includeVisualization) {
      visualization =
        await this.progressTracker.generateProgressVisualization(chatId);
    }

    // Generate AI-powered comprehensive summary
    const summary = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        overview: z.object({
          status: z.string(),
          overallProgress: z.number().min(0).max(100),
          currentPhase: z.enum([
            'planning',
            'design',
            'implementation',
            'completed',
          ]),
          phaseProgress: z.number().min(0).max(100),
          estimatedCompletion: z.string(),
          confidence: z.number().min(0).max(1),
        }),
        milestones: z.object({
          completed: z.array(
            z.object({
              name: z.string(),
              completedAt: z.string(),
              duration: z.string(),
            }),
          ),
          current: z.object({
            name: z.string(),
            progress: z.number().min(0).max(100),
            estimatedCompletion: z.string(),
          }),
          upcoming: z.array(
            z.object({
              name: z.string(),
              estimatedStart: z.string(),
              estimatedDuration: z.string(),
              dependencies: z.array(z.string()),
            }),
          ),
        }),
        performance: z.object({
          efficiency: z.object({
            questionReuseRate: z.number(),
            errorRate: z.number(),
            averageStepDuration: z.string(),
          }),
          trends: z.object({
            progressVelocity: z.string(),
            timeAccuracy: z.number().min(0).max(1),
            userEngagement: z.string(),
          }),
        }),
        insights: z.object({
          achievements: z.array(z.string()),
          challenges: z.array(z.string()),
          recommendations: z.array(z.string()),
          riskFactors: z.array(z.string()),
        }),
        visualization: z.object({
          progressChart: z.array(
            z.object({
              phase: z.string(),
              progress: z.number().min(0).max(100),
              status: z.enum(['completed', 'active', 'pending']),
            }),
          ),
          timeline: z.array(
            z.object({
              timestamp: z.string(),
              event: z.string(),
              type: z.enum(['milestone', 'completion', 'issue']),
            }),
          ),
        }),
      }),
      prompt: `Generate a comprehensive progress summary for the current workflow:

Current Progress Data:
- Overall Progress: ${progressInfo.overallProgress}%
- Current Phase: ${progressInfo.currentPhase}
- Phase Progress: ${progressInfo.phaseProgress}%
- Completed Steps: ${progressInfo.completedSteps}/${progressInfo.totalSteps}
- Time Estimate: ${timeEstimate.estimatedMinutes} minutes (confidence: ${timeEstimate.confidence})

Workflow Steps Status:
${state.workflowSteps
  ?.map(
    (step, i) => `
${i + 1}. ${step.name} (${step.status})
   - Agent: ${step.agentName}
   - Duration: ${step.estimatedDuration}s
   - Started: ${step.startTime || 'Not started'}
   - Completed: ${step.endTime || 'Not completed'}
   - Optional: ${step.isOptional}
`,
  )
  .join('')}

Performance Metrics:
${
  performanceMetrics
    ? `
- Question Reuse Rate: ${performanceMetrics.efficiency.questionReuseRate}%
- Error Rate: ${performanceMetrics.efficiency.errorRate}%
- Average Step Duration: ${performanceMetrics.efficiency.averageStepDuration}s
- Progress Velocity: ${performanceMetrics.trends.progressVelocity} steps/hour
- Error Trend: ${performanceMetrics.trends.errorTrend}
`
    : 'Performance metrics not available'
}

Recent Milestones:
${milestones.newMilestones.length > 0 ? milestones.newMilestones.join(', ') : 'No recent milestones'}

Verbosity Level: ${verbosity}

Generate a comprehensive summary that includes:

1. Overview:
   - Clear status description
   - Progress percentages
   - Realistic completion estimate
   - Confidence in the estimate

2. Milestones:
   - Completed milestones with timestamps and durations
   - Current milestone with progress
   - Upcoming milestones with estimates

3. Performance Analysis:
   - Efficiency metrics (question reuse, error rates, timing)
   - Trends (velocity, accuracy, engagement)

4. Insights:
   - Key achievements to celebrate
   - Current challenges to address
   - Actionable recommendations
   - Risk factors to monitor

5. Visualization Data:
   - Progress chart data for each phase
   - Timeline of key events

Adapt the detail level to the verbosity setting:
- Brief: Essential information only
- Standard: Balanced detail with key insights
- Detailed: Comprehensive analysis with full context

Be encouraging while being realistic about progress and challenges.`,
      system: `You are an expert project manager creating comprehensive progress reports.
      Provide accurate, actionable insights that help users understand their progress and make informed decisions.
      Balance optimism with realism, and focus on practical next steps.`,
    });

    // Enhance with visualization data if requested
    if (includeVisualization && visualization) {
      summary.object.visualization = {
        progressChart: Object.entries(visualization.phaseProgress).map(
          ([phase, progress]) => ({
            phase,
            progress,
            status:
              progress === 100
                ? ('completed' as const)
                : phase === progressInfo.currentPhase
                  ? ('active' as const)
                  : ('pending' as const),
          }),
        ),
        timeline: visualization.timeline.slice(-10).map((event) => ({
          timestamp: event.timestamp,
          event: event.event,
          type:
            event.type === 'step_completion'
              ? ('completion' as const)
              : event.type === 'error'
                ? ('issue' as const)
                : ('milestone' as const),
        })),
      };
    }

    return summary.object;
  }

  /**
   * Generate milestone tracking and completion notifications
   */
  async generateMilestoneReport(
    chatId: string,
    modelId: ChatModel['id'],
  ): Promise<{
    completedMilestones: Array<{
      name: string;
      completedAt: string;
      significance: 'minor' | 'major' | 'critical';
      celebrationMessage: string;
    }>;
    upcomingMilestones: Array<{
      name: string;
      estimatedDate: string;
      requirements: string[];
      blockers: string[];
    }>;
    milestoneInsights: {
      onTrack: boolean;
      delayRisk: 'low' | 'medium' | 'high';
      recommendations: string[];
    };
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const milestoneReport = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        completedMilestones: z.array(
          z.object({
            name: z.string(),
            completedAt: z.string(),
            significance: z.enum(['minor', 'major', 'critical']),
            celebrationMessage: z.string(),
          }),
        ),
        upcomingMilestones: z.array(
          z.object({
            name: z.string(),
            estimatedDate: z.string(),
            requirements: z.array(z.string()),
            blockers: z.array(z.string()),
          }),
        ),
        milestoneInsights: z.object({
          onTrack: z.boolean(),
          delayRisk: z.enum(['low', 'medium', 'high']),
          recommendations: z.array(z.string()),
        }),
      }),
      prompt: `Analyze workflow milestones and generate a comprehensive milestone report:

Current Workflow State:
- Phase: ${progressInfo.currentPhase || 'unknown'}
- Overall Progress: ${state.workflowSteps?.filter((s) => s.status === 'completed').length || 0}/${state.workflowSteps?.length || 0} steps
- Current Agent: ${state.currentAgent || 'none'}

Completed Steps (Potential Milestones):
${
  state.workflowSteps
    ?.filter((s) => s.status === 'completed')
    .map(
      (step) => `
- ${step.name} completed at ${step.endTime}
  Agent: ${step.agentName}
  Duration: ${
    step.startTime && step.endTime
      ? Math.round(
          (new Date(step.endTime).getTime() -
            new Date(step.startTime).getTime()) /
            1000,
        )
      : 'unknown'
  }s
`,
    )
    .join('') || 'No completed steps'
}

Remaining Steps (Future Milestones):
${
  state.workflowSteps
    ?.filter((s) => s.status !== 'completed' && s.status !== 'skipped')
    .map(
      (step) => `
- ${step.name} (${step.status})
  Agent: ${step.agentName}
  Dependencies: ${step.dependencies.join(', ') || 'None'}
  User Input Required: ${step.userInputRequired}
`,
    )
    .join('') || 'No remaining steps'
}

Performance Context:
- Error Count: ${state.performanceMetrics?.errorCount || 0}
- Question Reuse Rate: ${state.performanceMetrics?.questionsReused || 0}/${state.performanceMetrics?.totalQuestions || 0}

Analyze and provide:
1. Completed Milestones:
   - Identify significant achievements from completed steps
   - Classify significance level (minor/major/critical)
   - Generate appropriate celebration messages

2. Upcoming Milestones:
   - Identify key future milestones from remaining steps
   - Estimate completion dates based on current progress
   - List requirements and potential blockers

3. Milestone Insights:
   - Assess if milestones are on track
   - Evaluate delay risk
   - Provide actionable recommendations

Focus on meaningful milestones that represent real progress toward the overall goal.`,
      system: `You are an expert at milestone tracking and project management.
      Identify genuine achievements worth celebrating and provide realistic assessments of future milestones.
      Be encouraging while being honest about challenges and risks.`,
    });

    return milestoneReport.object;
  }

  /**
   * Generate progress visualization data optimized for UI display
   */
  async generateProgressVisualizationData(
    chatId: string,
    options: {
      includeTimeline?: boolean;
      includePhaseBreakdown?: boolean;
      includePerformanceCharts?: boolean;
      timeRange?: 'last_hour' | 'last_day' | 'all_time';
    } = {},
  ): Promise<{
    overallProgress: {
      percentage: number;
      status: string;
      trend: 'improving' | 'stable' | 'declining';
    };
    phaseBreakdown?: Array<{
      phase: string;
      progress: number;
      status: 'completed' | 'active' | 'pending';
      estimatedCompletion?: string;
    }>;
    timeline?: Array<{
      timestamp: string;
      event: string;
      type: 'milestone' | 'step_completion' | 'error' | 'user_action';
      details?: string;
    }>;
    performanceCharts?: {
      progressOverTime: Array<{
        timestamp: string;
        progress: number;
      }>;
      stepDurations: Array<{
        stepName: string;
        estimated: number;
        actual: number;
      }>;
      errorRate: Array<{
        period: string;
        errors: number;
      }>;
    };
  }> {
    const {
      includeTimeline = true,
      includePhaseBreakdown = true,
      includePerformanceCharts = false,
      timeRange = 'all_time',
    } = options;

    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const progressInfo = await this.progressTracker.calculateProgress(chatId);

    // Overall progress with trend analysis
    const progressTrend = this.calculateProgressTrend(state);

    const result: any = {
      overallProgress: {
        percentage: progressInfo.overallProgress,
        status: this.getProgressStatus(progressInfo.overallProgress),
        trend: progressTrend,
      },
    };

    // Phase breakdown
    if (includePhaseBreakdown) {
      const visualization =
        await this.progressTracker.generateProgressVisualization(chatId);
      result.phaseBreakdown = Object.entries(visualization.phaseProgress).map(
        ([phase, progress]) => ({
          phase,
          progress,
          status:
            progress === 100
              ? ('completed' as const)
              : phase === progressInfo.currentPhase
                ? ('active' as const)
                : ('pending' as const),
          estimatedCompletion:
            phase === progressInfo.currentPhase
              ? this.estimatePhaseCompletion(state, phase as WorkflowPhase)
              : undefined,
        }),
      );
    }

    // Timeline
    if (includeTimeline) {
      const timelineEvents = this.filterTimelineByRange(
        state.stateTransitionLog || [],
        timeRange,
      );

      result.timeline = timelineEvents.map((transition) => ({
        timestamp: transition.timestamp,
        event: transition.reason,
        type: this.categorizeTimelineEvent(transition.type),
        details: transition.metadata
          ? JSON.stringify(transition.metadata)
          : undefined,
      }));
    }

    // Performance charts
    if (includePerformanceCharts) {
      result.performanceCharts =
        await this.generatePerformanceChartData(chatId);
    }

    return result;
  }

  /**
   * Calculate progress trend based on recent activity
   */
  private calculateProgressTrend(
    state: EnhancedConversationState,
  ): 'improving' | 'stable' | 'declining' {
    const recentTransitions = (state.stateTransitionLog || []).slice(-10);
    const completionEvents = recentTransitions.filter(
      (t) => t.type.includes('step') || t.type.includes('advance'),
    );

    if (completionEvents.length >= 3) return 'improving';
    if (completionEvents.length === 0) return 'declining';
    return 'stable';
  }

  /**
   * Get progress status description
   */
  private getProgressStatus(progress: number): string {
    if (progress === 0) return 'Not Started';
    if (progress < 25) return 'Getting Started';
    if (progress < 50) return 'Making Progress';
    if (progress < 75) return 'Well Underway';
    if (progress < 100) return 'Nearly Complete';
    return 'Completed';
  }

  /**
   * Estimate phase completion time
   */
  private estimatePhaseCompletion(
    state: EnhancedConversationState,
    phase: WorkflowPhase,
  ): string {
    const phaseSteps =
      state.workflowSteps?.filter((step) => {
        // Map agents to phases
        const agentPhaseMap: Record<string, WorkflowPhase> = {
          core_agent: 'planning',
          diagram_agent: 'design',
          terraform_agent: 'implementation',
        };
        return agentPhaseMap[step.agentName] === phase;
      }) || [];

    const remainingSteps = phaseSteps.filter(
      (step) => step.status === 'pending' || step.status === 'active',
    );

    const totalEstimatedTime = remainingSteps.reduce(
      (sum, step) => sum + step.estimatedDuration,
      0,
    );

    return this.formatDuration(totalEstimatedTime);
  }

  /**
   * Filter timeline events by time range
   */
  private filterTimelineByRange(transitions: any[], timeRange: string): any[] {
    if (timeRange === 'all_time') return transitions;

    const now = new Date();
    const cutoff = new Date();

    switch (timeRange) {
      case 'last_hour':
        cutoff.setHours(now.getHours() - 1);
        break;
      case 'last_day':
        cutoff.setDate(now.getDate() - 1);
        break;
      default:
        return transitions;
    }

    return transitions.filter((t) => new Date(t.timestamp) >= cutoff);
  }

  /**
   * Categorize timeline events for visualization
   */
  private categorizeTimelineEvent(
    type: string,
  ): 'milestone' | 'step_completion' | 'error' | 'user_action' {
    if (type.includes('error') || type.includes('failed')) return 'error';
    if (type.includes('user')) return 'user_action';
    if (type.includes('step') || type.includes('advance'))
      return 'step_completion';
    return 'milestone';
  }

  /**
   * Generate performance chart data
   */
  private async generatePerformanceChartData(chatId: string): Promise<{
    progressOverTime: Array<{ timestamp: string; progress: number }>;
    stepDurations: Array<{
      stepName: string;
      estimated: number;
      actual: number;
    }>;
    errorRate: Array<{ period: string; errors: number }>;
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    // Progress over time (simplified)
    const progressOverTime = (state.stateTransitionLog || [])
      .filter((t) => t.type.includes('step') || t.type.includes('advance'))
      .map((t, index) => ({
        timestamp: t.timestamp,
        progress: Math.round(
          ((index + 1) / (state.workflowSteps?.length || 1)) * 100,
        ),
      }));

    // Step durations comparison
    const completedSteps =
      state.workflowSteps?.filter(
        (s) => s.status === 'completed' && s.startTime && s.endTime,
      ) || [];

    const stepDurations = completedSteps.map((step) => ({
      stepName: step.name,
      estimated: step.estimatedDuration,
      actual:
        step.endTime && step.startTime
          ? Math.round(
              (new Date(step.endTime).getTime() -
                new Date(step.startTime).getTime()) /
                1000,
            )
          : 0,
    }));

    // Error rate over time (simplified)
    const errorRate = [
      {
        period: 'Current Session',
        errors: state.performanceMetrics?.errorCount || 0,
      },
    ];

    return {
      progressOverTime,
      stepDurations,
      errorRate,
    };
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
}

/**
 * AI SDK V5 Tools for Progress Summary Generation
 */
export const createProgressSummaryTools = (
  chatId: string,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
  summaryGenerator: ProgressSummaryGenerator,
) => ({
  generateProgressSummary: tool({
    description: 'Generate comprehensive progress summary with all components',
    inputSchema: z.object({
      includeVisualization: z.boolean().default(true),
      includePerformanceMetrics: z.boolean().default(true),
      includeRecommendations: z.boolean().default(true),
      verbosity: z.enum(['brief', 'standard', 'detailed']).default('standard'),
    }),
    execute: async (options) => {
      const summary = await summaryGenerator.generateProgressSummary(
        chatId,
        modelId,
        options,
      );

      // Stream comprehensive summary to UI
      dataStream.write({
        type: 'data',
        data: summary,
        transient: false,
      });

      return summary;
    },
  }),

  generateMilestoneReport: tool({
    description: 'Generate milestone tracking and completion notifications',
    inputSchema: z.object({}),
    execute: async () => {
      const milestoneReport = await summaryGenerator.generateMilestoneReport(
        chatId,
        modelId,
      );

      // Stream milestone report to UI
      dataStream.write({
        type: 'data',
        data: milestoneReport,
        transient: false,
      });

      return milestoneReport;
    },
  }),

  generateProgressVisualizationData: tool({
    description:
      'Generate progress visualization data optimized for UI display',
    inputSchema: z.object({
      includeTimeline: z.boolean().default(true),
      includePhaseBreakdown: z.boolean().default(true),
      includePerformanceCharts: z.boolean().default(false),
      timeRange: z
        .enum(['last_hour', 'last_day', 'all_time'])
        .default('all_time'),
    }),
    execute: async (options) => {
      const visualizationData =
        await summaryGenerator.generateProgressVisualizationData(
          chatId,
          options,
        );

      // Stream visualization data to UI
      dataStream.write({
        type: 'data',
        data: visualizationData,
        transient: false,
      });

      return visualizationData;
    },
  }),
});
