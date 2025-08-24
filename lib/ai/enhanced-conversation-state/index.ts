// Export all types
export type {
  // Question management types
  QuestionHistoryEntry,
  AnswerValidation,
  ValidationIssue,
  ValidationRule,
  ContextualHelp,
  EnrichedClarificationRequest,
  // Workflow tracking types
  StepStatus,
  WorkflowStep,
  StepExecution,
  // Progress tracking types
  ProgressInfo,
  TimeEstimate,
  EstimationFactor,
  // User guidance types
  WorkflowGuidance,
  NextStep,
  UserAction,
  PhaseExplanation,
  // User preferences types
  UserPreferences,
  // State transition and audit types
  StateTransition,
  PerformanceMetrics,
  // Enhanced conversation state
  EnhancedConversationState,
  // Workflow action types
  WorkflowAction,
  // Question matching types
  QuestionMatch,
  // Error handling types
  HITLError,
  RecoveryOption,
} from './types';

// Export the enhanced state manager and related components
export { EnhancedStateManager } from './enhanced-state-manager';
export {
  generateQuestionHash,
  addQuestion,
  findSimilarQuestions,
  shouldReuseAnswer,
  addAnswerToQuestion,
  getQuestion,
  getAllQuestions,
  getQuestionsByAgent,
  getUnansweredQuestions,
  getReusedQuestions,
  addQuestionDependency,
  areDependenciesSatisfied,
  getReadyQuestions,
  getQuestionStats,
  cleanupOldQuestions,
} from './question-history-manager';
export * as WorkflowStepTracker from './workflow-step-tracker';
export { UserPreferenceManager } from './user-preference-manager';
export {
  createUserPreferenceTools,
  shouldAutoAdvance,
  getContentVerbosity,
  getAutoAdvanceTimeout,
} from './user-preference-tools';
export {
  UserActionHandler,
  createUserActionTools,
} from './user-action-handler';
export type { UserActionResult } from './user-action-handler';
export {
  generateStructuredAnalysis,
  streamToUI,
  AISchemas,
  AISDKIntegration,
  AIToolFactory,
  StreamingUtils,
} from './ai-sdk-integration';

// Export Smart Question Manager components
export * as SmartQuestionManager from './smart-question-manager';
export * as AnswerValidator from './answer-validator';
export * as ContextEnricher from './context-enricher';

// Export Workflow Orchestrator components
export {
  WorkflowOrchestrator,
  createWorkflowOrchestrationTools,
} from './workflow-orchestrator';

// Export Guidance Generator components
export {
  GuidanceGenerator,
  createUserGuidanceTools,
} from './guidance-generator';

// Export Workflow Action Handler components
export {
  WorkflowActionHandler,
  createWorkflowActionTools,
} from './workflow-action-handler';

// Export Progress Tracking components
export {
  ProgressTracker,
  createProgressTrackingTools,
} from './progress-tracker';
export { TimeEstimator, createTimeEstimationTools } from './time-estimator';
export {
  ProgressSummaryGenerator,
  createProgressSummaryTools,
} from './progress-summary-generator';

// Re-export base state manager and types for convenience
export {
  ConversationStateManager,
  AgentStatus,
  WorkflowPhase,
  type AgentName,
  type AgentWorkflowState,
  type ConversationState,
} from '../conversation-state';
