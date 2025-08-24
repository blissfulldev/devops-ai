import type { ClarificationRequest, ClarificationResponse } from '@/lib/types';
import type {
  WorkflowPhase,
  AgentName,
  ConversationState,
} from '../conversation-state';

// Enhanced question management types
export interface QuestionHistoryEntry {
  id: string;
  hash: string;
  question: string;
  context: string;
  agentName: string;
  timestamp: string;
  answer?: ClarificationResponse;
  validationResult?: AnswerValidation;
  reusedCount: number;
  dependencies: string[];
  relatedQuestions: string[];
}

export interface AnswerValidation {
  isValid: boolean;
  confidence: number;
  issues: ValidationIssue[];
  suggestions: string[];
  requiresFollowUp: boolean;
  followUpQuestions?: ClarificationRequest[];
}

export interface ValidationIssue {
  type: 'incomplete' | 'invalid_format' | 'out_of_range' | 'ambiguous';
  message: string;
  severity: 'error' | 'warning' | 'info';
  suggestedFix?: string;
}

export interface ValidationRule {
  type: 'required' | 'format' | 'range' | 'custom';
  rule: string;
  errorMessage: string;
  severity: 'error' | 'warning';
}

export interface ContextualHelp {
  explanation: string;
  whyAsked: string;
  howUsed: string;
  relatedConcepts: string[];
  documentationLinks: string[];
}

export interface EnrichedClarificationRequest extends ClarificationRequest {
  hash: string;
  dependencies: string[];
  relatedQuestions: string[];
  validationRules: ValidationRule[];
  contextualHelp: ContextualHelp;
  examples: string[];
  followUpActions: string[];
}

// Workflow tracking types
export type StepStatus =
  | 'pending'
  | 'active'
  | 'waiting_input'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  agentName: AgentName;
  status: StepStatus;
  startTime?: string;
  endTime?: string;
  estimatedDuration: number;
  dependencies: string[];
  userInputRequired: boolean;
  isOptional: boolean;
  skipReason?: string;
}

export interface StepExecution {
  stepId: string;
  startTime: string;
  endTime?: string;
  status: StepStatus;
  clarificationsRequested: number;
  clarificationsAnswered: number;
  errors?: string[];
}

// Progress tracking types
export interface ProgressInfo {
  overallProgress: number; // 0-100
  currentPhase: WorkflowPhase;
  phaseProgress: number; // 0-100
  completedSteps: number;
  totalSteps: number;
  stepsRequiringInput: number;
  stepsRemainingWithInput: number;
}

export interface TimeEstimate {
  estimatedMinutes: number;
  confidence: number;
  factors: EstimationFactor[];
}

export interface EstimationFactor {
  factor: string;
  impact: 'increases' | 'decreases' | 'neutral';
  description: string;
}

// User guidance types
export interface WorkflowGuidance {
  currentPhase: WorkflowPhase;
  phaseDescription: string;
  progressPercentage: number;
  estimatedTimeRemaining?: string;
  nextSteps: NextStep[];
  userActions: UserAction[];
  canProceedAutomatically: boolean;
  pendingRequirements: string[];
  helpfulTips?: string[];
  lastUpdated?: string;
}

export interface NextStep {
  id: string;
  title: string;
  description: string;
  estimatedDuration: string;
  requiresUserInput: boolean;
  isOptional: boolean;
}

export interface UserAction {
  id: string;
  label: string;
  description: string;
  type: 'continue' | 'skip' | 'restart' | 'modify' | 'help';
  enabled: boolean;
  consequences?: string;
  estimatedTime?: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface PhaseExplanation {
  phase: WorkflowPhase;
  title: string;
  description: string;
  objectives: string[];
  currentActivity: string;
  whatHappensNext: string;
  userRole: string;
  estimatedDuration?: string;
  keyMilestones: string[];
}

// User preferences types
export interface UserPreferences {
  autoAdvancePreference: 'always' | 'ask' | 'never';
  verbosityLevel: 'minimal' | 'normal' | 'detailed';
  skipOptionalSteps: boolean;
  preferredQuestionFormat: 'multiple_choice' | 'open_ended' | 'mixed';
  timeoutForAutoAdvance: number; // seconds
}

// State transition and audit types
export interface StateTransition {
  id?: string;
  type: string;
  from: string;
  to: string;
  timestamp: string;
  reason: string;
  agentName?: AgentName;
  metadata?: Record<string, any>;
}

export interface PerformanceMetrics {
  totalQuestions: number;
  questionsReused: number;
  averageResponseTime: number;
  workflowCompletionRate: number;
  userSatisfactionScore?: number;
  errorCount: number;
  lastUpdated: string;
}

// Enhanced conversation state
export interface EnhancedConversationState extends ConversationState {
  // Question management
  questionHistory: Map<string, QuestionHistoryEntry>;
  answerValidationResults: Map<string, AnswerValidation>;
  questionDependencies: Map<string, string[]>;

  // Workflow tracking
  workflowSteps: WorkflowStep[];
  currentStepIndex: number;
  stepExecutionHistory: StepExecution[];
  workflowCompleted?: boolean;
  completedAt?: string;

  // User guidance
  lastGuidanceGenerated?: WorkflowGuidance;
  userPreferences: UserPreferences;

  // Audit and debugging
  stateTransitionLog: StateTransition[];
  performanceMetrics: PerformanceMetrics;
}

// Workflow action types
export interface WorkflowAction {
  type:
    | 'continue_agent'
    | 'advance_to_next'
    | 'wait_for_input'
    | 'complete_workflow';
  agentName?: AgentName;
  reason: string;
  userNotification: string;
  autoExecute: boolean;
  confidence?: number;
  estimatedDuration?: string;
}

// Question matching types
export interface QuestionMatch {
  questionId: string;
  similarity: number;
  previousAnswer: ClarificationResponse;
  isReusable: boolean;
  confidence: number;
}

// Error handling types
export interface HITLError {
  type: 'question_processing' | 'state_sync' | 'validation' | 'auto_advance';
  severity: 'critical' | 'error' | 'warning';
  message: string;
  context: Record<string, any>;
  recoveryOptions: RecoveryOption[];
  timestamp: string;
}

export interface RecoveryOption {
  id: string;
  label: string;
  description: string;
  action: () => Promise<void>;
  riskLevel: 'low' | 'medium' | 'high';
}
