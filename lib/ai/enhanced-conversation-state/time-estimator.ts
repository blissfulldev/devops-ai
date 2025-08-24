import { generateObject, tool } from 'ai';
import { z } from 'zod';
import type { UIMessageStreamWriter } from 'ai/rsc';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import { myProvider } from '@/lib/ai/providers';
import type {
  EnhancedConversationState,
  WorkflowStep,
  TimeEstimate,
} from './types';
import type { EnhancedStateManager } from './enhanced-state-manager';

/**
 * Historical data for time estimation
 */
interface HistoricalStepData {
  agentName: string;
  stepName: string;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  clarificationsNeeded: number;
  successRate: number;
  sampleSize: number;
}

/**
 * TimeEstimator provides AI-powered time estimation using historical data
 * and intelligent analysis of workflow patterns
 */
export class TimeEstimator {
  private stateManager: EnhancedStateManager;
  private historicalData: Map<string, HistoricalStepData> = new Map();

  constructor(stateManager: EnhancedStateManager) {
    this.stateManager = stateManager;
    this.initializeHistoricalData();
  }

  /**
   * Initialize with baseline historical data
   */
  private initializeHistoricalData(): void {
    // Baseline data for different agent types
    const baselineData: HistoricalStepData[] = [
      {
        agentName: 'core_agent',
        stepName: 'Planning & Analysis',
        averageDuration: 300, // 5 minutes
        minDuration: 180,
        maxDuration: 600,
        clarificationsNeeded: 2.5,
        successRate: 0.95,
        sampleSize: 100,
      },
      {
        agentName: 'diagram_agent',
        stepName: 'Architecture Design',
        averageDuration: 240, // 4 minutes
        minDuration: 120,
        maxDuration: 480,
        clarificationsNeeded: 1.8,
        successRate: 0.92,
        sampleSize: 80,
      },
      {
        agentName: 'terraform_agent',
        stepName: 'Infrastructure Implementation',
        averageDuration: 420, // 7 minutes
        minDuration: 240,
        maxDuration: 900,
        clarificationsNeeded: 3.2,
        successRate: 0.88,
        sampleSize: 60,
      },
    ];

    baselineData.forEach((data) => {
      this.historicalData.set(`${data.agentName}_${data.stepName}`, data);
    });
  }

  /**
   * Estimate time remaining using AI-powered analysis and historical data
   */
  async estimateTimeRemaining(
    chatId: string,
    modelId: ChatModel['id'],
  ): Promise<TimeEstimate> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const remainingSteps =
      state.workflowSteps?.filter(
        (step) => step.status === 'pending' || step.status === 'active',
      ) || [];

    if (remainingSteps.length === 0) {
      return {
        estimatedMinutes: 0,
        confidence: 1.0,
        factors: [
          {
            factor: 'Workflow Complete',
            impact: 'neutral',
            description: 'All steps have been completed',
          },
        ],
      };
    }

    // Get user response patterns
    const userPatterns = this.analyzeUserPatterns(state);

    // Prepare data for AI analysis
    const stepEstimates = remainingSteps.map((step) => {
      const historical = this.getHistoricalData(step);
      return {
        stepName: step.name,
        agentName: step.agentName,
        baseEstimate: step.estimatedDuration,
        historicalAverage:
          historical?.averageDuration || step.estimatedDuration,
        clarificationsExpected: historical?.clarificationsNeeded || 2,
        successRate: historical?.successRate || 0.9,
        isOptional: step.isOptional,
        userInputRequired: step.userInputRequired,
      };
    });

    const estimate = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        estimatedMinutes: z.number().min(0),
        confidence: z.number().min(0).max(1),
        factors: z.array(
          z.object({
            factor: z.string(),
            impact: z.enum(['increases', 'decreases', 'neutral']),
            description: z.string(),
          }),
        ),
        breakdown: z.array(
          z.object({
            step: z.string(),
            estimatedMinutes: z.number(),
            uncertainty: z.enum(['low', 'medium', 'high']),
            reasoning: z.string(),
          }),
        ),
      }),
      prompt: `Estimate the time remaining to complete the workflow based on historical data and current context:

Remaining Steps Analysis:
${stepEstimates
  .map(
    (step) => `
- ${step.stepName} (${step.agentName})
  - Base Estimate: ${step.baseEstimate}s
  - Historical Average: ${step.historicalAverage}s
  - Expected Clarifications: ${step.clarificationsExpected}
  - Success Rate: ${(step.successRate * 100).toFixed(1)}%
  - User Input Required: ${step.userInputRequired}
  - Optional: ${step.isOptional}
`,
  )
  .join('')}

User Response Patterns:
- Average Response Time: ${userPatterns.averageResponseTime}s
- Clarification Frequency: ${userPatterns.clarificationFrequency}
- Question Reuse Rate: ${userPatterns.questionReuseRate}%
- Error Recovery Time: ${userPatterns.errorRecoveryTime}s

Current Context:
- Current Phase: ${state.currentPhase || 'unknown'}
- Pending Clarifications: ${state.pendingClarifications?.length || 0}
- Recent Errors: ${state.performanceMetrics?.errorCount || 0}
- Time of Day: ${new Date().getHours()}:${new Date().getMinutes().toString().padStart(2, '0')}

Consider these factors:
1. Historical performance data for each agent type
2. User response patterns and availability
3. Complexity of remaining steps
4. Current workflow momentum
5. Time of day and user availability patterns
6. Error rates and recovery time
7. Question reuse potential
8. Optional step skip probability

Provide:
- Total estimated time in minutes
- Confidence level (0-1) based on data quality and predictability
- Key factors affecting the estimate
- Per-step breakdown with uncertainty levels
- Reasoning for each step estimate`,
      system: `You are an expert at project time estimation with access to historical data.
      Be realistic about uncertainties while providing useful estimates.
      Consider both optimistic and pessimistic scenarios in your analysis.`,
    });

    // Update historical data with current execution
    this.updateHistoricalData(state);

    return estimate.object;
  }

  /**
   * Analyze user response patterns from historical data
   */
  private analyzeUserPatterns(state: EnhancedConversationState): {
    averageResponseTime: number;
    clarificationFrequency: number;
    questionReuseRate: number;
    errorRecoveryTime: number;
  } {
    const metrics = state.performanceMetrics || {
      totalQuestions: 0,
      questionsReused: 0,
      averageResponseTime: 60,
      workflowCompletionRate: 0,
      errorCount: 0,
      lastUpdated: new Date().toISOString(),
    };

    const completedSteps =
      state.workflowSteps?.filter((s) => s.status === 'completed').length || 0;

    return {
      averageResponseTime: metrics.averageResponseTime || 60,
      clarificationFrequency:
        completedSteps > 0 ? metrics.totalQuestions / completedSteps : 2,
      questionReuseRate:
        metrics.totalQuestions > 0
          ? (metrics.questionsReused / metrics.totalQuestions) * 100
          : 0,
      errorRecoveryTime: metrics.errorCount > 0 ? 120 : 0, // 2 minutes per error
    };
  }

  /**
   * Get historical data for a specific step
   */
  private getHistoricalData(
    step: WorkflowStep,
  ): HistoricalStepData | undefined {
    const key = `${step.agentName}_${step.name}`;
    return this.historicalData.get(key);
  }

  /**
   * Update historical data with current execution results
   */
  private updateHistoricalData(state: EnhancedConversationState): void {
    const completedSteps =
      state.workflowSteps?.filter(
        (s) => s.status === 'completed' && s.startTime && s.endTime,
      ) || [];

    completedSteps.forEach((step) => {
      const key = `${step.agentName}_${step.name}`;
      const duration = this.calculateStepDuration(step);

      if (duration > 0) {
        const existing = this.historicalData.get(key);
        if (existing) {
          // Update existing data with weighted average
          const newSampleSize = existing.sampleSize + 1;
          const weight = 1 / newSampleSize;

          existing.averageDuration =
            existing.averageDuration * (1 - weight) + duration * weight;
          existing.minDuration = Math.min(existing.minDuration, duration);
          existing.maxDuration = Math.max(existing.maxDuration, duration);
          existing.sampleSize = newSampleSize;
        } else {
          // Create new historical data entry
          this.historicalData.set(key, {
            agentName: step.agentName,
            stepName: step.name,
            averageDuration: duration,
            minDuration: duration,
            maxDuration: duration,
            clarificationsNeeded: 2, // Default
            successRate: 1.0,
            sampleSize: 1,
          });
        }
      }
    });
  }

  /**
   * Calculate actual duration of a completed step
   */
  private calculateStepDuration(step: WorkflowStep): number {
    if (!step.startTime || !step.endTime) return 0;

    const start = new Date(step.startTime).getTime();
    const end = new Date(step.endTime).getTime();

    return Math.round((end - start) / 1000); // Convert to seconds
  }

  /**
   * Generate time estimation with confidence scoring and accuracy improvement
   */
  async generateAdvancedTimeEstimate(
    chatId: string,
    modelId: ChatModel['id'],
    options: {
      includeOptimistic?: boolean;
      includePessimistic?: boolean;
      considerUserAvailability?: boolean;
      factorInComplexity?: boolean;
    } = {},
  ): Promise<{
    estimates: {
      optimistic: TimeEstimate;
      realistic: TimeEstimate;
      pessimistic: TimeEstimate;
    };
    recommendation: string;
    accuracyFactors: string[];
    improvementSuggestions: string[];
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const baseEstimate = await this.estimateTimeRemaining(chatId, modelId);

    const estimates = await generateObject({
      model: myProvider.languageModel(modelId),
      schema: z.object({
        estimates: z.object({
          optimistic: z.object({
            estimatedMinutes: z.number(),
            confidence: z.number().min(0).max(1),
            factors: z.array(
              z.object({
                factor: z.string(),
                impact: z.enum(['increases', 'decreases', 'neutral']),
                description: z.string(),
              }),
            ),
          }),
          realistic: z.object({
            estimatedMinutes: z.number(),
            confidence: z.number().min(0).max(1),
            factors: z.array(
              z.object({
                factor: z.string(),
                impact: z.enum(['increases', 'decreases', 'neutral']),
                description: z.string(),
              }),
            ),
          }),
          pessimistic: z.object({
            estimatedMinutes: z.number(),
            confidence: z.number().min(0).max(1),
            factors: z.array(
              z.object({
                factor: z.string(),
                impact: z.enum(['increases', 'decreases', 'neutral']),
                description: z.string(),
              }),
            ),
          }),
        }),
        recommendation: z.string(),
        accuracyFactors: z.array(z.string()),
        improvementSuggestions: z.array(z.string()),
      }),
      prompt: `Generate optimistic, realistic, and pessimistic time estimates:

Base Estimate: ${baseEstimate.estimatedMinutes} minutes (confidence: ${baseEstimate.confidence})

Current Workflow Context:
- Remaining Steps: ${state.workflowSteps?.filter((s) => s.status === 'pending' || s.status === 'active').length || 0}
- Current Phase: ${state.currentPhase || 'unknown'}
- Error Rate: ${state.performanceMetrics?.errorCount || 0} errors
- Question Reuse Rate: ${state.performanceMetrics?.questionsReused || 0}/${state.performanceMetrics?.totalQuestions || 0}

Historical Performance:
${Array.from(this.historicalData.entries())
  .map(
    ([key, data]) =>
      `- ${key}: ${Math.round(data.averageDuration / 60)}min avg (${data.sampleSize} samples)`,
  )
  .join('\n')}

Options:
- Include Optimistic: ${options.includeOptimistic !== false}
- Include Pessimistic: ${options.includePessimistic !== false}
- Consider User Availability: ${options.considerUserAvailability !== false}
- Factor In Complexity: ${options.factorInComplexity !== false}

Generate three scenarios:
1. Optimistic: Best-case scenario with minimal delays
2. Realistic: Most likely scenario based on historical data
3. Pessimistic: Worst-case scenario with potential complications

For each scenario, provide:
- Time estimate in minutes
- Confidence level
- Key factors affecting the estimate

Also provide:
- Overall recommendation for planning purposes
- Factors that affect estimate accuracy
- Suggestions for improving estimation accuracy`,
      system: `You are an expert project manager with deep experience in time estimation.
      Provide realistic scenarios that help users plan effectively while managing expectations.`,
    });

    return estimates.object;
  }

  /**
   * Analyze estimation accuracy and provide feedback
   */
  async analyzeEstimationAccuracy(chatId: string): Promise<{
    overallAccuracy: number;
    stepAccuracies: Array<{
      stepName: string;
      estimated: number;
      actual: number;
      accuracy: number;
      variance: number;
    }>;
    improvementAreas: string[];
    calibrationSuggestions: string[];
  }> {
    const state = await this.stateManager.getState(chatId);
    if (!state) {
      throw new Error(`No state found for chat ${chatId}`);
    }

    const completedSteps =
      state.workflowSteps?.filter(
        (s) => s.status === 'completed' && s.startTime && s.endTime,
      ) || [];

    if (completedSteps.length === 0) {
      return {
        overallAccuracy: 0,
        stepAccuracies: [],
        improvementAreas: ['No completed steps to analyze'],
        calibrationSuggestions: [
          'Complete more workflow steps to enable accuracy analysis',
        ],
      };
    }

    const stepAccuracies = completedSteps.map((step) => {
      const estimated = step.estimatedDuration;
      const actual = this.calculateStepDuration(step);
      const accuracy = actual > 0 ? Math.min(1, estimated / actual) : 0;
      const variance = Math.abs(estimated - actual);

      return {
        stepName: step.name,
        estimated,
        actual,
        accuracy,
        variance,
      };
    });

    const overallAccuracy =
      stepAccuracies.length > 0
        ? stepAccuracies.reduce((sum, step) => sum + step.accuracy, 0) /
          stepAccuracies.length
        : 0;

    // Identify improvement areas
    const improvementAreas: string[] = [];
    const highVarianceSteps = stepAccuracies.filter(
      (step) => step.variance > step.estimated * 0.5,
    );

    if (highVarianceSteps.length > 0) {
      improvementAreas.push(
        `High variance in: ${highVarianceSteps.map((s) => s.stepName).join(', ')}`,
      );
    }

    const underestimatedSteps = stepAccuracies.filter(
      (step) => step.actual > step.estimated * 1.2,
    );
    if (underestimatedSteps.length > 0) {
      improvementAreas.push(
        `Consistently underestimated: ${underestimatedSteps.map((s) => s.stepName).join(', ')}`,
      );
    }

    // Generate calibration suggestions
    const calibrationSuggestions: string[] = [];
    if (overallAccuracy < 0.8) {
      calibrationSuggestions.push(
        'Consider adding buffer time for unexpected delays',
      );
    }
    if (highVarianceSteps.length > stepAccuracies.length * 0.3) {
      calibrationSuggestions.push(
        'Break down complex steps into smaller, more predictable tasks',
      );
    }
    if (underestimatedSteps.length > 0) {
      calibrationSuggestions.push(
        'Increase base estimates for frequently underestimated step types',
      );
    }

    return {
      overallAccuracy,
      stepAccuracies,
      improvementAreas,
      calibrationSuggestions,
    };
  }

  /**
   * Get historical data summary for reporting
   */
  getHistoricalDataSummary(): Array<{
    key: string;
    agentName: string;
    stepName: string;
    averageDuration: string;
    sampleSize: number;
    reliability: 'low' | 'medium' | 'high';
  }> {
    return Array.from(this.historicalData.entries()).map(([key, data]) => ({
      key,
      agentName: data.agentName,
      stepName: data.stepName,
      averageDuration: this.formatDuration(data.averageDuration),
      sampleSize: data.sampleSize,
      reliability:
        data.sampleSize < 5 ? 'low' : data.sampleSize < 20 ? 'medium' : 'high',
    }));
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
 * AI SDK V5 Tools for Time Estimation
 */
export const createTimeEstimationTools = (
  chatId: string,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
  timeEstimator: TimeEstimator,
) => ({
  estimateTimeRemaining: tool({
    description:
      'Estimate time remaining using AI analysis and historical data',
    inputSchema: z.object({
      includeBreakdown: z.boolean().default(true),
      considerUserPatterns: z.boolean().default(true),
    }),
    execute: async ({ includeBreakdown, considerUserPatterns }) => {
      const estimate = await timeEstimator.estimateTimeRemaining(
        chatId,
        modelId,
      );

      // Stream time estimate to UI
      dataStream.write({
        type: 'data-timeEstimate',
        data: estimate,
        transient: false,
      });

      return estimate;
    },
  }),

  generateAdvancedTimeEstimate: tool({
    description:
      'Generate optimistic, realistic, and pessimistic time estimates',
    inputSchema: z.object({
      includeOptimistic: z.boolean().default(true),
      includePessimistic: z.boolean().default(true),
      considerUserAvailability: z.boolean().default(true),
      factorInComplexity: z.boolean().default(true),
    }),
    execute: async (options) => {
      const estimates = await timeEstimator.generateAdvancedTimeEstimate(
        chatId,
        modelId,
        options,
      );

      // Stream advanced estimates to UI
      dataStream.write({
        type: 'data-advancedTimeEstimate',
        data: estimates,
        transient: false,
      });

      return estimates;
    },
  }),

  analyzeEstimationAccuracy: tool({
    description: 'Analyze estimation accuracy and provide improvement feedback',
    inputSchema: z.object({}),
    execute: async () => {
      return await timeEstimator.analyzeEstimationAccuracy(chatId);
    },
  }),

  getHistoricalDataSummary: tool({
    description: 'Get summary of historical time estimation data',
    inputSchema: z.object({}),
    execute: async () => {
      return timeEstimator.getHistoricalDataSummary();
    },
  }),
});
