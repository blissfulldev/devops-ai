/**
 * UI-specific types for the Enhanced HITL System
 * These types are designed for React components and UI interactions
 */

import type {
  ValidationRule,
  ContextualHelp,
  AnswerValidation,
  ValidationIssue,
  WorkflowGuidance,
  UserAction,
  ProgressInfo,
  HITLError,
  RecoveryOption,
} from '../ai/enhanced-conversation-state/types';
import { HITLConfiguration } from '../types';

// Forward declarations to avoid circular imports
interface ClarificationRequest {
  id: string;
  agentName: string;
  question: string;
  context: string;
  options?: string[];
  priority: 'low' | 'medium' | 'high';
  timestamp: string;
  questionHash?: string;
  enrichedContext?: string;
  examples?: string[];
  relatedConcepts?: string[];
  validationRules?: ValidationRule[];
  reusedAnswerId?: string;
  confidenceScore?: number;
  userGuidance?: string;
  contextualHelp?: ContextualHelp;
  dependencies?: string[];
  followUpActions?: string[];
  estimatedAnswerTime?: number;
  difficultyLevel?: 'easy' | 'medium' | 'hard';
}

interface ClarificationResponse {
  id: string;
  requestId: string;
  answer: string;
  selectedOption?: string;
  timestamp: string;
  agentName?: 'core_agent' | 'diagram_agent' | 'terraform_agent';
  text?: string;
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

// Component State Types
export interface ClarificationUIState {
  currentRequest?: ClarificationRequest;
  pendingRequests: ClarificationRequest[];
  responses: ClarificationResponse[];
  isProcessing: boolean;
  showEnrichment: boolean;
  showValidation: boolean;
  errorState?: HITLError;
}

export interface WorkflowUIState {
  currentGuidance?: WorkflowGuidance;
  progress: ProgressInfo;
  availableActions: UserAction[];
  isAutoAdvancing: boolean;
  showDetails: boolean;
  lastUpdate: string;
}

// UI Event Handlers
export interface ClarificationHandlers {
  onSubmitAnswer: (
    requestId: string,
    answer: string,
    selectedOption?: string,
  ) => Promise<void>;
  onSkipQuestion: (requestId: string, reason?: string) => Promise<void>;
  onRequestHelp: (
    requestId: string,
    helpType: 'explanation' | 'examples' | 'guidance',
  ) => Promise<void>;
  onOverrideReuse: (requestId: string, reason: string) => Promise<void>;
  onRetryAnswer: (requestId: string) => Promise<void>;
  onProvideFeedback: (
    requestId: string,
    feedback: UserFeedback,
  ) => Promise<void>;
}

export interface WorkflowHandlers {
  onExecuteAction: (action: UserAction) => Promise<void>;
  onRequestGuidance: () => Promise<void>;
  onUpdatePreferences: (preferences: Partial<UserPreferences>) => Promise<void>;
  onReportIssue: (issue: UserReportedIssue) => Promise<void>;
}

// User Feedback Types
export interface UserFeedback {
  type: 'helpful' | 'confusing' | 'incorrect' | 'suggestion';
  rating?: number; // 1-5 scale
  comments?: string;
  suggestedImprovement?: string;
  wouldRecommend?: boolean;
}

export interface UserReportedIssue {
  type: 'bug' | 'confusion' | 'feature_request' | 'performance';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  stepsToReproduce?: string[];
  expectedBehavior?: string;
  actualBehavior?: string;
  userAgent?: string;
  timestamp: string;
}

// UI Display Types
export interface ClarificationDisplayOptions {
  showQuestionHash: boolean;
  showConfidenceScore: boolean;
  showRelatedConcepts: boolean;
  showValidationRules: boolean;
  showProcessingTime: boolean;
  enableRichText: boolean;
  enableVoiceInput: boolean;
  enableAutoComplete: boolean;
}

export interface WorkflowDisplayOptions {
  showProgressBar: boolean;
  showTimeEstimates: boolean;
  showPhaseDetails: boolean;
  showNextSteps: boolean;
  showUserActions: boolean;
  enableAnimations: boolean;
  compactMode: boolean;
  showDebugInfo: boolean;
}

// Form and Input Types
export interface ClarificationFormData {
  requestId: string;
  answer: string;
  selectedOption?: string;
  confidence?: number;
  timeSpent?: number;
  helpRequested?: boolean;
  additionalContext?: string;
}

export interface ValidationFormData {
  isAccurate: boolean;
  isHelpful: boolean;
  isComplete: boolean;
  suggestions?: string;
  rating?: number;
}

// Modal and Dialog Types
export interface ClarificationModalProps {
  isOpen: boolean;
  request: ClarificationRequest;
  onClose: () => void;
  onSubmit: (data: ClarificationFormData) => Promise<void>;
  options?: ClarificationDisplayOptions;
}

export interface ValidationModalProps {
  isOpen: boolean;
  validation: AnswerValidation;
  onClose: () => void;
  onRetry: () => Promise<void>;
  onAccept: () => Promise<void>;
  onFeedback: (feedback: ValidationFormData) => Promise<void>;
}

export interface ErrorModalProps {
  isOpen: boolean;
  error: HITLError;
  recoveryOptions: RecoveryOption[];
  onClose: () => void;
  onRecover: (optionId: string) => Promise<void>;
  onReport: (issue: UserReportedIssue) => Promise<void>;
}

// Toast and Notification Types
export interface ToastNotification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration?: number;
  actions?: ToastAction[];
  persistent?: boolean;
}

export interface ToastAction {
  label: string;
  action: () => void;
  style?: 'primary' | 'secondary' | 'danger';
}

// Loading and Status Types
export interface LoadingState {
  isLoading: boolean;
  operation?: string;
  progress?: number;
  estimatedTime?: number;
  canCancel?: boolean;
}

export interface StatusIndicator {
  status: 'idle' | 'processing' | 'success' | 'error' | 'warning';
  message?: string;
  details?: string;
  timestamp?: string;
}

// Accessibility Types
export interface AccessibilityOptions {
  enableScreenReader: boolean;
  enableKeyboardNavigation: boolean;
  enableHighContrast: boolean;
  enableReducedMotion: boolean;
  fontSize: 'small' | 'medium' | 'large' | 'extra-large';
  enableVoiceAnnouncements: boolean;
}

// Theme and Styling Types
export interface HITLTheme {
  colors: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
  };
}

// Animation and Transition Types
export interface AnimationConfig {
  enableAnimations: boolean;
  duration: {
    fast: number;
    normal: number;
    slow: number;
  };
  easing: {
    easeIn: string;
    easeOut: string;
    easeInOut: string;
  };
}

// Responsive Design Types
export interface ResponsiveBreakpoints {
  mobile: number;
  tablet: number;
  desktop: number;
  wide: number;
}

export interface ResponsiveConfig {
  breakpoints: ResponsiveBreakpoints;
  enableResponsive: boolean;
  mobileFirst: boolean;
}

// User Preferences for UI
export interface UserPreferences {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  timezone: string;
  displayOptions: ClarificationDisplayOptions & WorkflowDisplayOptions;
  accessibility: AccessibilityOptions;
  notifications: {
    enableToasts: boolean;
    enableSounds: boolean;
    enableVibration: boolean;
    autoHideDelay: number;
  };
  performance: {
    enableAnimations: boolean;
    enableAutoRefresh: boolean;
    refreshInterval: number;
    enableCaching: boolean;
  };
}

// Context Types for React
export interface HITLContextValue {
  state: ClarificationUIState & WorkflowUIState;
  handlers: ClarificationHandlers & WorkflowHandlers;
  config: HITLConfiguration;
  theme: HITLTheme;
  preferences: UserPreferences;
}

// Hook Return Types
export interface UseClarificationReturn {
  state: ClarificationUIState;
  handlers: ClarificationHandlers;
  utils: {
    formatQuestion: (request: ClarificationRequest) => string;
    validateAnswer: (
      answer: string,
      rules?: ValidationRule[],
    ) => ValidationIssue[];
    estimateAnswerTime: (request: ClarificationRequest) => number;
  };
}

export interface UseWorkflowReturn {
  state: WorkflowUIState;
  handlers: WorkflowHandlers;
  utils: {
    formatProgress: (progress: ProgressInfo) => string;
    formatTimeEstimate: (estimate: TimeEstimate) => string;
    getNextAction: () => UserAction | undefined;
  };
}

// Export all types for easy importing
export type {
  ClarificationRequest,
  ClarificationResponse,
  WorkflowGuidance,
  UserAction,
  ProgressInfo,
  AnswerValidation,
  ValidationIssue,
  HITLError,
  RecoveryOption,
} from '../types';
