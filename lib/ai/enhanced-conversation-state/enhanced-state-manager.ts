import type { ClarificationRequest } from '@/lib/types';
import {
  ConversationStateManager,
  type AgentName,
  type ConversationState,
} from '../conversation-state';
import type {
  EnhancedConversationState,
  QuestionHistoryEntry,
  AnswerValidation,
  WorkflowStep,
  WorkflowGuidance,
  UserPreferences,
  StateTransition,
  PerformanceMetrics,
  StepStatus,
} from './types';
import * as UserPreferenceManager from './user-preference-manager';

// In-memory store for enhanced state (swap for Redis/DB in prod)
const enhancedConversationStates = new Map<string, EnhancedConversationState>();

// Default user preferences (removed unused variable)

// Default performance metrics
const DEFAULT_PERFORMANCE_METRICS: PerformanceMetrics = {
  totalQuestions: 0,
  questionsReused: 0,
  averageResponseTime: 0,
  workflowCompletionRate: 0,
  errorCount: 0,
  lastUpdated: new Date().toISOString(),
};

/**
 * Enhanced State Manager that extends the basic ConversationStateManager
 * with advanced HITL capabilities
 */
export class EnhancedStateManager {
  /**
   * Get enhanced conversation state, creating it if it doesn't exist
   */
  static getEnhancedState(chatId: string): EnhancedConversationState {
    if (!enhancedConversationStates.has(chatId)) {
      // Get base state from existing manager
      const baseState = ConversationStateManager.getState(chatId);

      // Create enhanced state extending base state
      const enhancedState: EnhancedConversationState = {
        ...baseState,
        // Question management
        questionHistory: new Map(),
        answerValidationResults: new Map(),
        questionDependencies: new Map(),

        // Workflow tracking
        workflowSteps: EnhancedStateManager.initializeWorkflowSteps(),
        currentStepIndex: 0,
        stepExecutionHistory: [],

        // User guidance
        lastGuidanceGenerated: undefined,
        userPreferences: UserPreferenceManager.getUserPreferences(chatId),

        // Audit and debugging
        stateTransitionLog: [],
        performanceMetrics: { ...DEFAULT_PERFORMANCE_METRICS },
      };

      enhancedConversationStates.set(chatId, enhancedState);
    }

    const state = enhancedConversationStates.get(chatId);
    if (!state) {
      throw new Error(
        `Failed to get enhanced conversation state for chat ${chatId}`,
      );
    }

    return state;
  }

  /**
   * Update enhanced conversation state with transition logging
   */
  static updateEnhancedState(
    chatId: string,
    updater: (s: EnhancedConversationState) => void,
    reason = 'Manual update',
    agentName?: AgentName,
  ): void {
    const state = EnhancedStateManager.getEnhancedState(chatId);

    updater(state);

    // Log state transition
    const transition: StateTransition = {
      id: EnhancedStateManager.generateId(),
      type: 'update',
      from: 'previous_state',
      to: 'updated_state',
      timestamp: new Date().toISOString(),
      reason,
      agentName,
    };

    state.stateTransitionLog.push(transition);

    // Keep transition log manageable (last 100 entries)
    if (state.stateTransitionLog.length > 100) {
      state.stateTransitionLog = state.stateTransitionLog.slice(-100);
    }

    enhancedConversationStates.set(chatId, state);

    // Also update base state to keep them in sync
    ConversationStateManager.updateState(chatId, (baseState) => {
      Object.assign(baseState, EnhancedStateManager.extractBaseState(state));
    });
  }

  /**
   * Log a state transition for audit purposes
   */
  static async logStateTransition(
    chatId: string,
    transition: Omit<StateTransition, 'id'>,
  ): Promise<void> {
    const state = EnhancedStateManager.getEnhancedState(chatId);

    const fullTransition: StateTransition = {
      ...transition,
      id: EnhancedStateManager.generateId(),
    };

    state.stateTransitionLog.push(fullTransition);

    // Keep transition log manageable (last 100 entries)
    if (state.stateTransitionLog.length > 100) {
      state.stateTransitionLog = state.stateTransitionLog.slice(-100);
    }

    enhancedConversationStates.set(chatId, state);
  }

  /**
   * Clear enhanced state
   */
  static clearEnhancedState(chatId: string): void {
    enhancedConversationStates.delete(chatId);
    ConversationStateManager.clearState(chatId);
  }

  /**
   * Initialize default workflow steps based on agent order
   */
  private static initializeWorkflowSteps(): WorkflowStep[] {
    const agentOrder: AgentName[] = [
      'core_agent',
      'diagram_agent',
      'terraform_agent',
    ];

    return agentOrder.map((agentName, index) => ({
      id: `step-${index + 1}`,
      name: EnhancedStateManager.getStepName(agentName),
      description: EnhancedStateManager.getStepDescription(agentName),
      agentName,
      status: 'pending' as StepStatus,
      estimatedDuration: EnhancedStateManager.getEstimatedDuration(agentName),
      dependencies: index > 0 ? [`step-${index}`] : [],
      userInputRequired: true, // Most steps may require clarification
      isOptional: false,
    }));
  }

  /**
   * Get human-readable step name for agent
   */
  private static getStepName(agentName: AgentName): string {
    const stepNames: Record<AgentName, string> = {
      core_agent: 'Planning & Analysis',
      diagram_agent: 'Architecture Design',
      terraform_agent: 'Infrastructure Implementation',
    };
    return stepNames[agentName];
  }

  /**
   * Get step description for agent
   */
  private static getStepDescription(agentName: AgentName): string {
    const descriptions: Record<AgentName, string> = {
      core_agent: 'Analyze requirements and create implementation plan',
      diagram_agent: 'Design system architecture and create diagrams',
      terraform_agent: 'Generate and deploy infrastructure code',
    };
    return descriptions[agentName];
  }

  /**
   * Get estimated duration for agent step
   */
  private static getEstimatedDuration(agentName: AgentName): number {
    const durations: Record<AgentName, number> = {
      core_agent: 300, // 5 minutes
      diagram_agent: 180, // 3 minutes
      terraform_agent: 600, // 10 minutes
    };
    return durations[agentName];
  }

  /**
   * Extract base state properties from enhanced state
   */
  private static extractBaseState(
    enhancedState: EnhancedConversationState,
  ): ConversationState {
    const {
      // Remove enhanced properties
      questionHistory,
      answerValidationResults,
      questionDependencies,
      workflowSteps,
      currentStepIndex,
      stepExecutionHistory,
      lastGuidanceGenerated,
      userPreferences,
      stateTransitionLog,
      performanceMetrics,
      ...baseState
    } = enhancedState;

    return baseState;
  }

  // Removed unused cloneStateForAudit method

  /**
   * Generate unique ID for state transitions
   */
  private static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  // Question History Management
  static addQuestionToHistory(
    chatId: string,
    question: ClarificationRequest,
    hash: string,
  ): void {
    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        const entry: QuestionHistoryEntry = {
          id: question.id,
          hash,
          question: question.question,
          context: question.context,
          agentName: question.agentName,
          timestamp: question.timestamp,
          reusedCount: 0,
          dependencies: [],
          relatedQuestions: [],
        };

        state.questionHistory.set(question.id, entry);
        state.performanceMetrics.totalQuestions++;
      },
      `Added question to history: ${question.id}`,
      question.agentName as AgentName,
    );
  }

  static getQuestionFromHistory(
    chatId: string,
    questionId: string,
  ): QuestionHistoryEntry | undefined {
    const state = EnhancedStateManager.getEnhancedState(chatId);
    return state.questionHistory.get(questionId);
  }

  static findSimilarQuestions(
    chatId: string,
    hash: string,
  ): QuestionHistoryEntry[] {
    const state = EnhancedStateManager.getEnhancedState(chatId);
    const similar: QuestionHistoryEntry[] = [];

    for (const entry of state.questionHistory.values()) {
      if (entry.hash === hash && entry.answer) {
        similar.push(entry);
      }
    }

    return similar;
  }

  static markQuestionReused(chatId: string, questionId: string): void {
    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        const entry = state.questionHistory.get(questionId);
        if (entry) {
          entry.reusedCount++;
          state.performanceMetrics.questionsReused++;
        }
      },
      `Marked question as reused: ${questionId}`,
    );
  }

  // Answer Validation Management
  static addAnswerValidation(
    chatId: string,
    questionId: string,
    validation: AnswerValidation,
  ): void {
    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        state.answerValidationResults.set(questionId, validation);

        // Update question history with validation result
        const entry = state.questionHistory.get(questionId);
        if (entry) {
          entry.validationResult = validation;
        }
      },
      `Added answer validation for question: ${questionId}`,
    );
  }

  static getAnswerValidation(
    chatId: string,
    questionId: string,
  ): AnswerValidation | undefined {
    const state = EnhancedStateManager.getEnhancedState(chatId);
    return state.answerValidationResults.get(questionId);
  }

  // Workflow Step Management
  static updateWorkflowStep(
    chatId: string,
    stepId: string,
    status: StepStatus,
    agentName?: AgentName,
  ): void {
    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        const step = state.workflowSteps.find((s) => s.id === stepId);
        if (step) {
          const oldStatus = step.status;
          step.status = status;

          if (status === 'active' && !step.startTime) {
            step.startTime = new Date().toISOString();
          }

          if (
            (status === 'completed' || status === 'failed') &&
            !step.endTime
          ) {
            step.endTime = new Date().toISOString();
          }

          // Update current step index if this step is now active
          if (status === 'active') {
            const stepIndex = state.workflowSteps.findIndex(
              (s) => s.id === stepId,
            );
            if (stepIndex !== -1) {
              state.currentStepIndex = stepIndex;
            }
          }

          console.log(
            `Workflow step ${stepId} status changed: ${oldStatus} -> ${status}`,
          );
        }
      },
      `Updated workflow step ${stepId} to ${status}`,
      agentName,
    );
  }

  static getCurrentWorkflowStep(chatId: string): WorkflowStep | undefined {
    const state = EnhancedStateManager.getEnhancedState(chatId);
    return state.workflowSteps[state.currentStepIndex];
  }

  static getWorkflowSteps(chatId: string): WorkflowStep[] {
    const state = EnhancedStateManager.getEnhancedState(chatId);
    return [...state.workflowSteps];
  }

  // User Preferences Management
  static updateUserPreferences(
    chatId: string,
    preferences: Partial<UserPreferences>,
  ): void {
    // Use UserPreferenceManager for validation and storage
    const validatedPrefs = UserPreferenceManager.setUserPreferences(
      chatId,
      preferences,
    );

    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        state.userPreferences = validatedPrefs;
      },
      'Updated user preferences',
    );
  }

  static getUserPreferences(chatId: string): UserPreferences {
    // Get preferences from UserPreferenceManager for consistency
    const prefs = UserPreferenceManager.getUserPreferences(chatId);

    // Also update the enhanced state to keep it in sync
    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        state.userPreferences = prefs;
      },
      'Synced user preferences',
    );

    return prefs;
  }

  // Additional user preference methods
  static resetUserPreferences(chatId: string): UserPreferences {
    const defaultPrefs = UserPreferenceManager.resetPreferences(chatId);

    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        state.userPreferences = defaultPrefs;
      },
      'Reset user preferences to defaults',
    );

    return defaultPrefs;
  }

  static updateUserPreference<K extends keyof UserPreferences>(
    chatId: string,
    key: K,
    value: UserPreferences[K],
  ): UserPreferences {
    const updatedPrefs = UserPreferenceManager.setPreference(
      chatId,
      key,
      value,
    );

    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        state.userPreferences = updatedPrefs;
      },
      `Updated user preference: ${key}`,
    );

    return updatedPrefs;
  }

  static getUserPreferenceSummary(chatId: string): {
    preferences: UserPreferences;
    isCustomized: boolean;
    summary: string;
  } {
    return UserPreferenceManager.getPreferenceSummary(chatId);
  }

  static exportUserPreferences(chatId: string): {
    chatId: string;
    preferences: UserPreferences;
    exportedAt: string;
  } {
    return UserPreferenceManager.exportPreferences(chatId);
  }

  static importUserPreferences(data: {
    chatId: string;
    preferences: UserPreferences;
    exportedAt: string;
  }): UserPreferences {
    const importedPrefs = UserPreferenceManager.importPreferences(
      data.chatId,
      data,
    );

    EnhancedStateManager.updateEnhancedState(
      data.chatId,
      (state) => {
        state.userPreferences = importedPrefs;
      },
      'Imported user preferences',
    );

    return importedPrefs;
  }

  // Performance Metrics
  static updatePerformanceMetrics(
    chatId: string,
    updates: Partial<PerformanceMetrics>,
  ): void {
    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        state.performanceMetrics = {
          ...state.performanceMetrics,
          ...updates,
          lastUpdated: new Date().toISOString(),
        };
      },
      'Updated performance metrics',
    );
  }

  static getPerformanceMetrics(chatId: string): PerformanceMetrics {
    const state = EnhancedStateManager.getEnhancedState(chatId);
    return { ...state.performanceMetrics };
  }

  // State Transition Logging
  static getStateTransitionLog(chatId: string): StateTransition[] {
    const state = EnhancedStateManager.getEnhancedState(chatId);
    return [...state.stateTransitionLog];
  }

  // Workflow Guidance Management
  static setWorkflowGuidance(chatId: string, guidance: WorkflowGuidance): void {
    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        state.lastGuidanceGenerated = guidance;
      },
      'Updated workflow guidance',
    );
  }

  static getWorkflowGuidance(chatId: string): WorkflowGuidance | undefined {
    const state = EnhancedStateManager.getEnhancedState(chatId);
    return state.lastGuidanceGenerated;
  }

  // Instance methods for WorkflowOrchestrator compatibility
  async getState(chatId: string): Promise<EnhancedConversationState | null> {
    try {
      return EnhancedStateManager.getEnhancedState(chatId);
    } catch {
      return null;
    }
  }

  async updateState(
    chatId: string,
    updates: Partial<EnhancedConversationState>,
  ): Promise<void> {
    EnhancedStateManager.updateEnhancedState(
      chatId,
      (state) => {
        Object.assign(state, updates);
      },
      'Workflow orchestrator update',
    );
  }

  async logStateTransition(
    chatId: string,
    transition: Omit<StateTransition, 'id'>,
  ): Promise<void> {
    return EnhancedStateManager.logStateTransition(chatId, transition);
  }
}
