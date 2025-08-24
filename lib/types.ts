import { z } from 'zod';
import type { getWeather } from './ai/tools/get-weather';
import type { createDocument } from './ai/tools/create-document';
import type { updateDocument } from './ai/tools/update-document';
import type { requestSuggestions } from './ai/tools/request-suggestions';
import type { requestClarification } from './ai/tools/request-clarification';
import type { InferUITool, UIMessage } from 'ai';

import type { ArtifactKind } from '@/components/artifact';
import type { Suggestion } from './db/schema';

// Import enhanced types for better type safety
import type {
  ValidationRule,
  ContextualHelp,
  AnswerValidation,
  ValidationIssue,
  WorkflowGuidance,
  UserAction,
  NextStep,
  PhaseExplanation,
  ProgressInfo,
  TimeEstimate,
  HITLError,
  RecoveryOption,
} from './ai/enhanced-conversation-state/types';

export type DataPart = { type: 'append-message'; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;
type requestClarificationTool = InferUITool<
  ReturnType<typeof requestClarification>
>;

export type ChatTools = {
  getWeather: weatherTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  requestClarification: requestClarificationTool;
};

export type CustomUIDataTypes = {
  // Existing artifact and content types
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;

  // Core clarification types
  clarificationRequest: ClarificationRequest;
  clarificationResponse: ClarificationResponse;

  // Enhanced HITL UI data types - Question Management
  answerReuse: {
    questionId: string;
    reusedAnswer: ClarificationResponse;
    reasoning: string;
    originalQuestion: string;
    confidence: number;
    similarityScore: number;
    canOverride: boolean;
    overrideReason?: string;
  };

  // Only one declaration for each property, using the most complete type
  userActionRequest: {
    availableActions: Array<{
      id: string;
      label: string;
      description: string;
      type: 'continue' | 'skip' | 'restart' | 'modify' | 'help';
      enabled: boolean;
      consequences?: string;
      estimatedTime?: string;
      riskLevel?: 'low' | 'medium' | 'high';
    }>;
    currentContext: string;
    recommendedAction?: any;
    consequences?: Record<string, string>;
    timeoutSeconds?: number;
  };
  userActionResult: {
    success: boolean;
    actionId: string;
    actionType: 'continue' | 'skip' | 'restart' | 'modify' | 'help';
    message: string;
    nextSteps?: string[];
    stateChanges?: string[];
    consequences?: string[];
    estimatedImpact?: string;
    canUndo?: boolean;
    undoInstructions?: string;
  };
  hitlError: {
    error: {
      type: string;
      severity: 'critical' | 'error' | 'warning' | 'info';
      message: string;
      context: Record<string, any>;
      recoveryOptions: Array<{
        id: string;
        label: string;
        description: string;
        riskLevel: 'low' | 'medium' | 'high';
      }>;
      timestamp: string;
    };
    recoveryOptions: Array<{
      id: string;
      label: string;
      description: string;
      riskLevel: 'low' | 'medium' | 'high';
    }>;
    canContinue: boolean;
    userGuidance: string;
    technicalDetails?: string;
  };
  errorRecovery: {
    errorId?: string;
    success: boolean;
    message: string;
    nextActions?: string[];
    recoveryOptionId?: string;
    restoredState?: string;
  };
  notification: {
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
    actions?: Array<{
      label: string;
      action: string;
      style?: 'primary' | 'secondary' | 'danger';
    }>;
    autoHide?: boolean;
    duration?: number;
  };
      timeToAnswer: number;
      retryCount: number;
      helpRequested: boolean;
    };
  };

  // Workflow Guidance and Progress
  workflowGuidance: {
    guidance: WorkflowGuidance;
    currentPhase: string;
    progressPercentage: number;
    nextSteps: NextStep[];
    userActions: UserAction[];
    estimatedTimeRemaining: string;
    canProceedAutomatically: boolean;
  };

  phaseExplanation: {
    explanation: PhaseExplanation;
    currentActivity: string;
    whatHappensNext: string;
    userRole: string;
    keyMilestones: string[];
  };

  progressUpdate: {
    progress: ProgressInfo;
    overallProgress: number;
    currentPhase: string;
    completedSteps: number;
    totalSteps: number;
    timeEstimate: TimeEstimate;
    recentActivity: string[];
  };

  // User Actions and Controls
  userActionRequest: {
    availableActions: UserAction[];
    currentContext: string;
    recommendedAction?: UserAction;
    consequences: Record<string, string>;
    timeoutSeconds?: number;
  };

  userActionResult: {
    actionId: string;
    actionType: UserAction['type'];
    success: boolean;
    message: string;
    nextSteps?: string[];
    stateChanges?: string[];
  };

  // Error Handling and Recovery
  hitlError: {
    error: HITLError;
    recoveryOptions: RecoveryOption[];
    canContinue: boolean;
    userGuidance: string;
    technicalDetails?: string;
  };

  errorRecovery: {
    recoveryOptionId: string;
    success: boolean;
    message: string;
    restoredState?: string;
    nextActions?: string[];
  };

  // System Status and Health
  systemStatus: {
    status: 'healthy' | 'degraded' | 'error';
    components: Record<string, 'operational' | 'degraded' | 'failed'>;
    lastHealthCheck: string;
    uptime: number;
    activeUsers: number;
  };

  performanceMetrics: {
    averageResponseTime: number;
    questionProcessingTime: number;
    validationAccuracy: number;
    userSatisfactionScore: number;
    systemLoad: number;
    cacheHitRate: number;
  };

  // Debug and Development
  debugInfo: {
    stateSnapshot: Record<string, any>;
    recentTransitions: string[];
    performanceTimings: Record<string, number>;
    memoryUsage: number;
    activeQueries: number;
  };

  // Notifications and Alerts
  notification: {
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
    actions?: Array<{
      label: string;
      action: string;
      style?: 'primary' | 'secondary' | 'danger';
    }>;
    autoHide?: boolean;
    duration?: number;
  };

  // Real-time Updates
  liveUpdate: {
    type:
      | 'question_processed'
      | 'answer_validated'
      | 'workflow_advanced'
      | 'state_changed';
    data: Record<string, any>;
    timestamp: string;
    source: string;
  };

  // User Preference Management
  userPreferences: {
    preferences: any; // UserPreferences type
    hasCustomizations: boolean;
    updated?: boolean;
    reset?: boolean;
    imported?: boolean;
    changedKeys?: string[];
  };

  preferenceRecommendations: {
    recommendations: Array<{
      preference: string;
      currentValue: any;
      recommendedValue: any;
      reason: string;
      confidence: number;
    }>;
    reasoning: string;
    appliedRecommendations?: any[];
    totalRecommendations: number;
    highConfidenceCount: number;
  };

  preferencesExport: {
    success: boolean;
    exportData?: any;
    exportedAt: string;
    error?: string;
  };

  // User Action Handling
  userActionRequest: {
    availableActions: Array<{
      id: string;
      label: string;
      description: string;
      type: 'continue' | 'skip' | 'restart' | 'modify' | 'help';
      enabled: boolean;
      consequences?: string;
      estimatedTime?: string;
      riskLevel?: 'low' | 'medium' | 'high';
    }>;
    currentContext: string;
    recommendedAction?: any;
    consequences?: Record<string, string>;
    timeoutSeconds?: number;
  };

  userActionResult: {
    success: boolean;
    actionId: string;
    actionType: 'continue' | 'skip' | 'restart' | 'modify' | 'help';
    message: string;
    nextSteps?: string[];
    stateChanges?: string[];
    consequences?: string[];
    estimatedImpact?: string;
    canUndo?: boolean;
    undoInstructions?: string;
  };

  contextualHelp: {
    helpContent: Array<{
      title: string;
      content: string;
      examples?: string[];
    }>;
    quickActions: string[];
    relatedTopics: string[];
    currentContext?: {
      phase: string;
      agent?: string;
      waitingForClarification: boolean;
    };
  };

  // Error Handling and Recovery
  hitlError: {
    error: {
      type: string;
      severity: 'critical' | 'error' | 'warning' | 'info';
      message: string;
      context: Record<string, any>;
      recoveryOptions: Array<{
        id: string;
        label: string;
        description: string;
        riskLevel: 'low' | 'medium' | 'high';
      }>;
      timestamp: string;
    };
    recoveryOptions: Array<{
      id: string;
      label: string;
      description: string;
      riskLevel: 'low' | 'medium' | 'high';
    }>;
    canContinue: boolean;
    userGuidance: string;
    technicalDetails?: string;
  };

  errorRecovery: {
    errorId?: string;
    success: boolean;
    message: string;
    nextActions?: string[];
    recoveryOptionId?: string;
    restoredState?: string;
  };

  errorStats: {
    stats: Record<string, number>;
    recentErrors?: Array<{
      type: string;
      severity: string;
      message: string;
      timestamp: string;
    }>;
  };

  notification: {
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
    actions?: Array<{
      label: string;
      action: string;
      style?: 'primary' | 'secondary' | 'danger';
    }>;
    autoHide?: boolean;
    duration?: number;
  };
};

export interface ClarificationRequest {
  id: string;
  agentName: string;
  question: string;
  context: string;
  options?: string[];
  priority: 'low' | 'medium' | 'high';
  timestamp: string;
  // Enhanced HITL fields
  questionHash?: string;
  enrichedContext?: string;
  examples?: string[];
  relatedConcepts?: string[];
  validationRules?: ValidationRule[];
  reusedAnswerId?: string;
  confidenceScore?: number;
  userGuidance?: string;
  // Additional enrichment fields
  contextualHelp?: ContextualHelp;
  dependencies?: string[];
  followUpActions?: string[];
  estimatedAnswerTime?: number;
  difficultyLevel?: 'easy' | 'medium' | 'hard';
}

export interface ClarificationResponse {
  id: string;
  requestId: string;
  answer: string;
  selectedOption?: string;
  timestamp: string;
  agentName?: 'core_agent' | 'diagram_agent' | 'terraform_agent';
  text?: string;
  // Enhanced HITL fields
  validationResult?: AnswerValidation;
  isValid?: boolean;
  confidence?: number;
  processingTime?: number;
  wasReused?: boolean;
  originalQuestionId?: string;
  followUpQuestions?: ClarificationRequest[];
  userFeedback?: {
    helpful: boolean;
    rating?: number;
    comments?: string;
  };
}

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export interface Attachment {
  name: string;
  url: string;
  contentType: string;
}

// Enhanced HITL utility types
export type ClarificationPriority = 'low' | 'medium' | 'high';
export type ValidationSeverity = 'error' | 'warning' | 'info';
export type UserExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type WorkflowActionType =
  | 'continue'
  | 'skip'
  | 'restart'
  | 'modify'
  | 'help';

// UI Component Props Types
export interface ClarificationRequestProps {
  request: ClarificationRequest;
  onAnswer: (response: ClarificationResponse) => void;
  onSkip?: () => void;
  onHelp?: () => void;
  showEnrichment?: boolean;
  allowOverride?: boolean;
}

export interface ValidationFeedbackProps {
  validation: AnswerValidation;
  onRetry?: () => void;
  onAccept?: () => void;
  onRequestHelp?: () => void;
  showDetails?: boolean;
}

export interface WorkflowGuidanceProps {
  guidance: WorkflowGuidance;
  onAction: (action: UserAction) => void;
  showProgress?: boolean;
  showEstimates?: boolean;
}

export interface ProgressIndicatorProps {
  progress: ProgressInfo;
  timeEstimate?: TimeEstimate;
  showDetails?: boolean;
  compact?: boolean;
}

// Event types for UI interactions
export interface ClarificationEvent {
  type:
    | 'answer_submitted'
    | 'help_requested'
    | 'skip_requested'
    | 'override_requested';
  requestId: string;
  data?: Record<string, any>;
  timestamp: string;
}

export interface WorkflowEvent {
  type:
    | 'action_requested'
    | 'phase_changed'
    | 'progress_updated'
    | 'guidance_requested';
  data: Record<string, any>;
  timestamp: string;
  source: 'user' | 'system' | 'agent';
}

// Configuration types
export interface HITLConfiguration {
  enableQuestionDeduplication: boolean;
  enableAnswerValidation: boolean;
  enableContextEnrichment: boolean;
  enableAutoAdvancement: boolean;
  confidenceThreshold: number;
  maxRetryAttempts: number;
  timeoutSeconds: number;
  userExperienceLevel: UserExperienceLevel;
  verbosityLevel: 'minimal' | 'normal' | 'detailed';
}

// Analytics and metrics types
export interface ClarificationMetrics {
  totalQuestions: number;
  questionsAnswered: number;
  questionsSkipped: number;
  questionsReused: number;
  averageResponseTime: number;
  averageRetryCount: number;
  validationAccuracy: number;
  userSatisfactionScore?: number;
}

export interface WorkflowMetrics {
  totalWorkflows: number;
  completedWorkflows: number;
  averageCompletionTime: number;
  mostCommonStoppingPoints: string[];
  userEngagementScore: number;
  autoAdvancementRate: number;
}
