/**
 * Comprehensive type definitions for the Enhanced HITL System
 * This file serves as the main export point for all HITL-related types
 */

// Re-export core types
export type {
  ClarificationRequest,
  ClarificationResponse,
  CustomUIDataTypes,
  ClarificationPriority,
  ValidationSeverity,
  UserExperienceLevel,
  WorkflowActionType,
  ClarificationRequestProps,
  ValidationFeedbackProps,
  WorkflowGuidanceProps,
  ProgressIndicatorProps,
  ClarificationEvent,
  WorkflowEvent,
  HITLConfiguration,
  ClarificationMetrics,
  WorkflowMetrics,
} from '../types';

// Re-export enhanced conversation state types
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

// Re-export UI types
export type {
  ClarificationUIState,
  WorkflowUIState,
  ClarificationHandlers,
  WorkflowHandlers,
  UserFeedback,
  UserReportedIssue,
  ClarificationDisplayOptions,
  WorkflowDisplayOptions,
  ClarificationFormData,
  ValidationFormData,
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

// Additional utility types for the complete system
export interface HITLSystemConfig {
  // Core system configuration
  enabledFeatures: {
    questionDeduplication: boolean;
    answerValidation: boolean;
    contextEnrichment: boolean;
    workflowOrchestration: boolean;
    progressTracking: boolean;
    userGuidance: boolean;
    errorRecovery: boolean;
    analytics: boolean;
  };

  // AI configuration
  aiConfig: {
    modelId: string;
    confidenceThreshold: number;
    maxRetries: number;
    timeoutMs: number;
    enableCaching: boolean;
    cacheExpiryMs: number;
  };

  // Performance configuration
  performance: {
    maxConcurrentQuestions: number;
    maxHistorySize: number;
    enableBatching: boolean;
    batchSize: number;
    enableCompression: boolean;
  };

  // Security configuration
  security: {
    enableInputSanitization: boolean;
    enableOutputFiltering: boolean;
    maxInputLength: number;
    allowedFileTypes: string[];
    enableRateLimiting: boolean;
    rateLimit: {
      requests: number;
      windowMs: number;
    };
  };
}

// System status and health monitoring
export interface HITLSystemStatus {
  status: 'healthy' | 'degraded' | 'error' | 'maintenance';
  version: string;
  uptime: number;
  lastHealthCheck: string;
  components: {
    questionManager: ComponentStatus;
    answerValidator: ComponentStatus;
    contextEnricher: ComponentStatus;
    workflowOrchestrator: ComponentStatus;
    progressTracker: ComponentStatus;
    stateManager: ComponentStatus;
    aiIntegration: ComponentStatus;
  };
  metrics: {
    totalRequests: number;
    successRate: number;
    averageResponseTime: number;
    errorRate: number;
    cacheHitRate: number;
    memoryUsage: number;
    cpuUsage: number;
  };
}

export interface ComponentStatus {
  status: 'operational' | 'degraded' | 'failed';
  lastCheck: string;
  responseTime?: number;
  errorCount: number;
  message?: string;
}

// Event system types
export interface HITLEvent {
  id: string;
  type: HITLEventType;
  timestamp: string;
  source: 'user' | 'system' | 'agent' | 'ai';
  data: Record<string, any>;
  metadata?: {
    sessionId?: string;
    userId?: string;
    agentName?: string;
    requestId?: string;
    correlationId?: string;
  };
}

export type HITLEventType =
  // Question events
  | 'question_received'
  | 'question_processed'
  | 'question_enriched'
  | 'question_deduplicated'
  | 'question_reused'
  // Answer events
  | 'answer_submitted'
  | 'answer_validated'
  | 'answer_accepted'
  | 'answer_rejected'
  | 'answer_retry_requested'
  // Workflow events
  | 'workflow_started'
  | 'workflow_advanced'
  | 'workflow_paused'
  | 'workflow_completed'
  | 'workflow_failed'
  // User events
  | 'user_action_requested'
  | 'user_action_executed'
  | 'user_feedback_provided'
  | 'user_help_requested'
  // System events
  | 'system_error'
  | 'system_recovery'
  | 'system_maintenance'
  | 'system_update';

// Analytics and reporting types
export interface HITLAnalytics {
  timeRange: {
    start: string;
    end: string;
  };
  summary: {
    totalSessions: number;
    totalQuestions: number;
    totalAnswers: number;
    completionRate: number;
    averageSessionDuration: number;
    userSatisfactionScore: number;
  };
  questionAnalytics: {
    mostCommonQuestions: Array<{
      question: string;
      count: number;
      averageAnswerTime: number;
    }>;
    questionsByCategory: Record<string, number>;
    reuseRate: number;
    validationAccuracy: number;
  };
  workflowAnalytics: {
    completionRateByPhase: Record<string, number>;
    averageTimeByPhase: Record<string, number>;
    mostCommonStoppingPoints: string[];
    autoAdvancementRate: number;
  };
  userAnalytics: {
    engagementScore: number;
    helpRequestRate: number;
    retryRate: number;
    feedbackScore: number;
  };
  performanceAnalytics: {
    averageResponseTime: number;
    errorRate: number;
    cacheHitRate: number;
    systemLoad: number;
  };
}

// Testing and debugging types
export interface HITLTestScenario {
  id: string;
  name: string;
  description: string;
  steps: HITLTestStep[];
  expectedOutcome: string;
  tags: string[];
}

export interface HITLTestStep {
  action:
    | 'ask_question'
    | 'submit_answer'
    | 'validate_answer'
    | 'advance_workflow'
    | 'check_state';
  data: Record<string, any>;
  expectedResult?: Record<string, any>;
  timeout?: number;
}

export interface HITLDebugInfo {
  sessionId: string;
  timestamp: string;
  state: {
    conversationState: Record<string, any>;
    questionHistory: QuestionHistoryEntry[];
    workflowSteps: WorkflowStep[];
    userPreferences: UserPreferences;
  };
  recentEvents: HITLEvent[];
  performanceMetrics: {
    memoryUsage: number;
    processingTimes: Record<string, number>;
    cacheStats: Record<string, number>;
  };
  errors: Array<{
    timestamp: string;
    error: HITLError;
    stackTrace?: string;
  }>;
}

// Migration and versioning types
export interface HITLMigration {
  version: string;
  description: string;
  up: (data: any) => Promise<any>;
  down: (data: any) => Promise<any>;
  validate: (data: any) => boolean;
}

export interface HITLVersionInfo {
  current: string;
  available?: string;
  changelog: Array<{
    version: string;
    date: string;
    changes: string[];
    breaking: boolean;
  }>;
}

// Plugin and extension types
export interface HITLPlugin {
  name: string;
  version: string;
  description: string;
  author: string;
  dependencies?: string[];
  hooks: {
    beforeQuestionProcess?: (
      question: ClarificationRequest,
    ) => Promise<ClarificationRequest>;
    afterAnswerValidation?: (
      validation: AnswerValidation,
    ) => Promise<AnswerValidation>;
    onWorkflowAdvance?: (step: WorkflowStep) => Promise<void>;
    onError?: (error: HITLError) => Promise<void>;
  };
  config?: Record<string, any>;
}

// Complete system interface
export interface HITLSystem {
  config: HITLSystemConfig;
  status: HITLSystemStatus;
  analytics: HITLAnalytics;
  plugins: HITLPlugin[];
  version: HITLVersionInfo;

  // Core methods
  initialize: (config: HITLSystemConfig) => Promise<void>;
  shutdown: () => Promise<void>;
  healthCheck: () => Promise<HITLSystemStatus>;

  // Event system
  emit: (event: HITLEvent) => void;
  on: (eventType: HITLEventType, handler: (event: HITLEvent) => void) => void;
  off: (eventType: HITLEventType, handler: (event: HITLEvent) => void) => void;

  // Plugin system
  loadPlugin: (plugin: HITLPlugin) => Promise<void>;
  unloadPlugin: (name: string) => Promise<void>;

  // Debug and testing
  getDebugInfo: (sessionId: string) => Promise<HITLDebugInfo>;
  runTest: (scenario: HITLTestScenario) => Promise<boolean>;
}
