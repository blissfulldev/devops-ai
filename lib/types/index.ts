/**
 * Enhanced HITL Types - Main Export File
 *
 * This file provides convenient access to all Enhanced HITL system types.
 * Import from here to get access to all types in one place.
 */

// Export core types from main types file
export type {
  ClarificationRequest,
  ClarificationResponse,
  ClarificationPriority,
  ValidationSeverity,
  UserExperienceLevel,
  WorkflowActionType,
} from '../types';

// Export UI-specific types
export type {
  ClarificationUIState,
  WorkflowUIState,
  ClarificationHandlers,
  WorkflowHandlers,
  ClarificationModalProps,
  ValidationModalProps,
  ErrorModalProps,
  ToastNotification,
  ToastAction,
  LoadingState,
  StatusIndicator,
  AccessibilityOptions,
  HITLTheme,
  AnimationConfig,
  ResponsiveBreakpoints,
  ResponsiveConfig,
  HITLContextValue,
  UseClarificationReturn,
  UseWorkflowReturn,
} from './ui';

// Export comprehensive HITL system types
export type {
  HITLSystemConfig,
  HITLSystemStatus,
  HITLAnalytics,
  HITLSystem,
} from './enhanced-hitl';

// Export enhanced conversation state types
export type {
  QuestionHistoryEntry,
  AnswerValidation,
  ValidationIssue,
  ValidationRule,
  ContextualHelp,
  EnrichedClarificationRequest,
  StepStatus,
  WorkflowStep,
  StepExecution,
  ProgressInfo,
  TimeEstimate,
  EstimationFactor,
  WorkflowGuidance,
  NextStep,
  UserAction,
  PhaseExplanation,
  UserPreferences,
  StateTransition,
  PerformanceMetrics,
  EnhancedConversationState,
  WorkflowAction,
  QuestionMatch,
  HITLError,
  RecoveryOption,
} from '../ai/enhanced-conversation-state/types';

// Re-export some commonly used types for convenience
export type {
  ClarificationRequestProps,
  ValidationFeedbackProps,
  WorkflowGuidanceProps,
  ProgressIndicatorProps,
  ClarificationEvent,
  WorkflowEvent,
  HITLConfiguration,
  ClarificationMetrics,
  WorkflowMetrics,
  UserFeedback,
  UserReportedIssue,
  ClarificationDisplayOptions,
  WorkflowDisplayOptions,
  ClarificationFormData,
  ValidationFormData,
  CustomUIDataTypes,
} from './ui';

// Import types for type guards
import type { ClarificationRequest, ClarificationResponse } from '../types';
import type {
  AnswerValidation,
  WorkflowGuidance,
} from '../ai/enhanced-conversation-state/types';

// Type guards for runtime type checking
export const isValidClarificationRequest = (
  obj: any,
): obj is ClarificationRequest => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.agentName === 'string' &&
    typeof obj.question === 'string' &&
    typeof obj.context === 'string' &&
    ['low', 'medium', 'high'].includes(obj.priority) &&
    typeof obj.timestamp === 'string'
  );
};

export const isValidClarificationResponse = (
  obj: any,
): obj is ClarificationResponse => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.requestId === 'string' &&
    typeof obj.answer === 'string' &&
    typeof obj.timestamp === 'string'
  );
};

export const isValidAnswerValidation = (obj: any): obj is AnswerValidation => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.isValid === 'boolean' &&
    typeof obj.confidence === 'number' &&
    Array.isArray(obj.issues) &&
    Array.isArray(obj.suggestions) &&
    typeof obj.requiresFollowUp === 'boolean'
  );
};

export const isValidWorkflowGuidance = (obj: any): obj is WorkflowGuidance => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.currentPhase === 'string' &&
    typeof obj.phaseDescription === 'string' &&
    typeof obj.progressPercentage === 'number' &&
    Array.isArray(obj.nextSteps) &&
    Array.isArray(obj.userActions) &&
    typeof obj.canProceedAutomatically === 'boolean' &&
    Array.isArray(obj.pendingRequirements)
  );
};

// Utility functions for type manipulation
export const createEmptyClarificationRequest =
  (): Partial<ClarificationRequest> => ({
    priority: 'medium',
    timestamp: new Date().toISOString(),
  });

export const createEmptyAnswerValidation = (): AnswerValidation => ({
  isValid: false,
  confidence: 0,
  issues: [],
  suggestions: [],
  qualityScore: 0,
  feedback: '',
});

export const createEmptyWorkflowGuidance = (): WorkflowGuidance => ({
  currentPhase: 'planning',
  phaseDescription: '',
  progressPercentage: 0,
  nextSteps: [],
  userActions: [],
  canProceedAutomatically: false,
  pendingRequirements: [],
  estimatedTimeRemaining: undefined,
  lastUpdated: new Date().toISOString(),
});

// Constants for common values
export const CLARIFICATION_PRIORITIES = ['low', 'medium', 'high'] as const;
export const VALIDATION_SEVERITIES = ['error', 'warning', 'info'] as const;
export const USER_EXPERIENCE_LEVELS = [
  'beginner',
  'intermediate',
  'advanced',
] as const;
export const WORKFLOW_ACTION_TYPES = [
  'continue',
  'skip',
  'restart',
  'modify',
  'help',
] as const;

// Import types for default configurations
import type {
  HITLConfiguration,
  ClarificationDisplayOptions,
  WorkflowDisplayOptions,
} from './ui';

// Default configurations
export const DEFAULT_HITL_CONFIG: HITLConfiguration = {
  enableQuestionDeduplication: true,
  enableAnswerValidation: true,
  enableContextEnrichment: true,
  enableAutoAdvancement: true,
  confidenceThreshold: 0.8,
  maxRetryAttempts: 3,
  timeoutSeconds: 300,
  userExperienceLevel: 'intermediate',
  verbosityLevel: 'normal',
};

export const DEFAULT_DISPLAY_OPTIONS: ClarificationDisplayOptions &
  WorkflowDisplayOptions = {
  // Clarification display options
  showQuestionHash: false,
  showConfidenceScore: true,
  showRelatedConcepts: true,
  showValidationRules: false,
  showProcessingTime: false,
  enableRichText: true,
  enableVoiceInput: false,
  enableAutoComplete: true,

  // Workflow display options
  showProgressBar: true,
  showTimeEstimates: true,
  showPhaseDetails: true,
  showNextSteps: true,
  showUserActions: true,
  enableAnimations: true,
  compactMode: false,
  showDebugInfo: false,
};
