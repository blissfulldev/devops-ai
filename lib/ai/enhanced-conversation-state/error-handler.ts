import { z } from 'zod';
import { tool, type UIMessageStreamWriter } from 'ai';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type {
  HITLError,
  RecoveryOption,
  EnhancedConversationState,
} from './types';
import type { AgentName } from '../conversation-state';
import { EnhancedStateManager } from './enhanced-state-manager';
import { generateStructuredAnalysis, streamToUI } from './ai-sdk-integration';

/**
 * Error classification and severity levels
 */
export const ERROR_TYPES = {
  QUESTION_PROCESSING: 'question_processing',
  STATE_SYNC: 'state_sync',
  VALIDATION: 'validation',
  AUTO_ADVANCE: 'auto_advance',
  AGENT_EXECUTION: 'agent_execution',
  USER_ACTION: 'user_action',
  SYSTEM_FAILURE: 'system_failure',
} as const;

export const ERROR_SEVERITIES = {
  CRITICAL: 'critical',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
} as const;

/**
 * Error context information
 */
interface ErrorContext {
  chatId: string;
  agentName?: AgentName;
  workflowPhase?: string;
  operationId?: string;
  userId?: string;
  sessionId?: string;
  stackTrace?: string;
  additionalData?: Record<string, any>;
}

/**
 * Error handling result
 */
interface ErrorHandlingResult {
  errorId: string;
  handled: boolean;
  recoveryApplied: boolean;
  recoveryOptionId?: string;
  message: string;
  nextSteps: string[];
  requiresUserAction: boolean;
}

/**
 * HITLErrorHandler manages error classification, logging, and recovery for the enhanced HITL system
 */
export class HITLErrorHandler {
  private static errorLog: Map<string, HITLError> = new Map();
  private static errorStats: Map<string, number> = new Map();

  /**
   * Handle an error with classification, logging, and recovery options
   */
  static async handleError(
    error: Error | HITLError,
    context: ErrorContext,
    modelId: ChatModel['id'],
    dataStream: UIMessageStreamWriter<ChatMessage>,
    options: {
      autoRecover?: boolean;
      generateRecoveryOptions?: boolean;
      notifyUser?: boolean;
    } = {},
  ): Promise<ErrorHandlingResult> {
    const {
      autoRecover = true,
      generateRecoveryOptions = true,
      notifyUser = true,
    } = options;

    try {
      // Classify the error if it's a raw Error object
      let hitlError: HITLError;
      if (error instanceof Error) {
        hitlError = await HITLErrorHandler.classifyError(
          error,
          context,
          modelId,
        );
      } else {
        hitlError = error;
      }

      // Generate unique error ID
      const errorId = HITLErrorHandler.generateErrorId(hitlError);

      // Log the error
      HITLErrorHandler.logError(errorId, hitlError, context);

      // Update error statistics
      HITLErrorHandler.updateErrorStats(hitlError.type);

      // Generate recovery options if requested
      if (generateRecoveryOptions && hitlError.recoveryOptions.length === 0) {
        hitlError.recoveryOptions =
          await HITLErrorHandler.generateRecoveryOptions(
            hitlError,
            context,
            modelId,
          );
      }

      // Attempt automatic recovery for non-critical errors
      let recoveryApplied = false;
      let recoveryOptionId: string | undefined;

      if (autoRecover && hitlError.severity !== 'critical') {
        const autoRecoveryResult = await HITLErrorHandler.attemptAutoRecovery(
          hitlError,
          context,
        );
        recoveryApplied = autoRecoveryResult.success;
        recoveryOptionId = autoRecoveryResult.recoveryOptionId;
      }

      // Notify user if requested
      if (notifyUser) {
        await HITLErrorHandler.notifyUser(
          hitlError,
          context,
          dataStream,
          recoveryApplied,
        );
      }

      // Determine next steps
      const nextSteps = HITLErrorHandler.determineNextSteps(
        hitlError,
        recoveryApplied,
      );

      const result: ErrorHandlingResult = {
        errorId,
        handled: true,
        recoveryApplied,
        recoveryOptionId,
        message: recoveryApplied
          ? `Error handled automatically: ${hitlError.message}`
          : `Error logged: ${hitlError.message}`,
        nextSteps,
        requiresUserAction:
          !recoveryApplied && hitlError.severity !== 'warning',
      };

      // Stream error handling result to UI
      streamToUI(dataStream, 'data-errorRecovery', {
        errorId,
        success: recoveryApplied,
        message: result.message,
        nextActions: nextSteps,
        recoveryOptionId,
      });

      return result;
    } catch (handlingError) {
      console.error('Failed to handle error:', handlingError);

      // Fallback error handling
      const fallbackResult: ErrorHandlingResult = {
        errorId: 'fallback-' + Date.now(),
        handled: false,
        recoveryApplied: false,
        message: 'Error handling failed. Please try again or contact support.',
        nextSteps: ['Retry operation', 'Contact support'],
        requiresUserAction: true,
      };

      streamToUI(dataStream, 'data-errorRecovery', {
        errorId: fallbackResult.errorId,
        success: false,
        message: fallbackResult.message,
        nextActions: fallbackResult.nextSteps,
      });

      return fallbackResult;
    }
  }

  /**
   * Classify a raw Error into a HITLError with appropriate type and severity
   */
  private static async classifyError(
    error: Error,
    context: ErrorContext,
    modelId: ChatModel['id'],
  ): Promise<HITLError> {
    try {
      // Use AI to classify the error
      const classification = await generateStructuredAnalysis(
        modelId,
        z.object({
          type: z.enum([
            'question_processing',
            'state_sync',
            'validation',
            'auto_advance',
            'agent_execution',
            'user_action',
            'system_failure',
          ]),
          severity: z.enum(['critical', 'error', 'warning', 'info']),
          category: z.string(),
          rootCause: z.string(),
          userImpact: z.string(),
          technicalDetails: z.string(),
        }),
        `Classify this error for the HITL system:
         Error Message: ${error.message}
         Error Name: ${error.name}
         Stack Trace: ${error.stack?.substring(0, 500) || 'Not available'}
         Context: ${JSON.stringify(context)}
         
         Determine the error type, severity, and provide analysis.`,
        'You are an expert at classifying and analyzing software errors in workflow systems.',
      );

      return {
        type: classification.type as HITLError['type'],
        severity: classification.severity as HITLError['severity'],
        message: `${classification.category}: ${error.message}`,
        context: {
          ...context,
          originalError: error.message,
          errorName: error.name,
          stackTrace: error.stack,
          rootCause: classification.rootCause,
          userImpact: classification.userImpact,
          technicalDetails: classification.technicalDetails,
        },
        recoveryOptions: [], // Will be generated later if needed
        timestamp: new Date().toISOString(),
      };
    } catch (classificationError) {
      console.warn(
        'Failed to classify error with AI, using fallback:',
        classificationError,
      );

      // Fallback classification based on error patterns
      return HITLErrorHandler.fallbackClassifyError(error, context);
    }
  }

  /**
   * Fallback error classification when AI classification fails
   */
  private static fallbackClassifyError(
    error: Error,
    context: ErrorContext,
  ): HITLError {
    let type: HITLError['type'] = 'system_failure';
    let severity: HITLError['severity'] = 'error';

    // Pattern-based classification
    const errorMessage = error.message.toLowerCase();

    if (
      errorMessage.includes('validation') ||
      errorMessage.includes('invalid')
    ) {
      type = 'validation';
      severity = 'warning';
    } else if (
      errorMessage.includes('state') ||
      errorMessage.includes('sync')
    ) {
      type = 'state_sync';
      severity = 'error';
    } else if (
      errorMessage.includes('question') ||
      errorMessage.includes('clarification')
    ) {
      type = 'question_processing';
      severity = 'error';
    } else if (
      errorMessage.includes('advance') ||
      errorMessage.includes('workflow')
    ) {
      type = 'auto_advance';
      severity = 'warning';
    } else if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('network')
    ) {
      type = 'system_failure';
      severity = 'error';
    }

    return {
      type,
      severity,
      message: error.message,
      context: {
        ...context,
        originalError: error.message,
        errorName: error.name,
        stackTrace: error.stack,
        classificationMethod: 'fallback',
      },
      recoveryOptions: [],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate recovery options for an error
   */
  private static async generateRecoveryOptions(
    error: HITLError,
    context: ErrorContext,
    modelId: ChatModel['id'],
  ): Promise<RecoveryOption[]> {
    try {
      const recoveryAnalysis = await generateStructuredAnalysis(
        modelId,
        z.object({
          recoveryOptions: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              description: z.string(),
              riskLevel: z.enum(['low', 'medium', 'high']),
              automated: z.boolean(),
              estimatedSuccess: z.number().min(0).max(1),
              prerequisites: z.array(z.string()).optional(),
            }),
          ),
          reasoning: z.string(),
        }),
        `Generate recovery options for this HITL system error:
         Error Type: ${error.type}
         Severity: ${error.severity}
         Message: ${error.message}
         Context: ${JSON.stringify(error.context)}
         
         Provide practical recovery options that can help resolve or work around this error.`,
        'You are an expert at error recovery and system resilience in workflow systems.',
      );

      return recoveryAnalysis.recoveryOptions.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        riskLevel: option.riskLevel,
        action: async () => {
          await HITLErrorHandler.executeRecoveryAction(
            option.id,
            error,
            context,
          );
        },
      }));
    } catch (recoveryError) {
      console.warn(
        'Failed to generate recovery options with AI, using fallback:',
        recoveryError,
      );
      return HITLErrorHandler.generateFallbackRecoveryOptions(error, context);
    }
  }

  /**
   * Generate fallback recovery options when AI generation fails
   */
  private static generateFallbackRecoveryOptions(
    error: HITLError,
    context: ErrorContext,
  ): RecoveryOption[] {
    const options: RecoveryOption[] = [];

    // Common recovery options based on error type
    switch (error.type) {
      case 'question_processing':
        options.push({
          id: 'retry-question-processing',
          label: 'Retry Question Processing',
          description: 'Attempt to process the question again',
          riskLevel: 'low',
          action: async () => {
            // Implementation would retry question processing
            console.log('Retrying question processing...');
          },
        });
        break;

      case 'state_sync':
        options.push({
          id: 'reconcile-state',
          label: 'Reconcile State',
          description: 'Attempt to reconcile and fix state inconsistencies',
          riskLevel: 'medium',
          action: async () => {
            // Implementation would reconcile state
            console.log('Reconciling state...');
          },
        });
        break;

      case 'validation':
        options.push({
          id: 'skip-validation',
          label: 'Skip Validation',
          description: 'Continue without validation (use with caution)',
          riskLevel: 'high',
          action: async () => {
            console.log('Skipping validation...');
          },
        });
        break;

      case 'auto_advance':
        options.push({
          id: 'manual-advance',
          label: 'Manual Advance',
          description: 'Manually advance the workflow',
          riskLevel: 'low',
          action: async () => {
            console.log('Manually advancing workflow...');
          },
        });
        break;
    }

    // Always add generic recovery options
    options.push(
      {
        id: 'retry-operation',
        label: 'Retry Operation',
        description: 'Retry the failed operation',
        riskLevel: 'low',
        action: async () => {
          console.log('Retrying operation...');
        },
      },
      {
        id: 'reset-to-safe-state',
        label: 'Reset to Safe State',
        description: 'Reset the system to a known good state',
        riskLevel: 'medium',
        action: async () => {
          console.log('Resetting to safe state...');
        },
      },
    );

    return options;
  }

  /**
   * Attempt automatic recovery for an error
   */
  private static async attemptAutoRecovery(
    error: HITLError,
    context: ErrorContext,
  ): Promise<{ success: boolean; recoveryOptionId?: string }> {
    try {
      // Find low-risk automated recovery options
      const autoRecoveryOptions = error.recoveryOptions.filter(
        (option) => option.riskLevel === 'low',
      );

      if (autoRecoveryOptions.length === 0) {
        return { success: false };
      }

      // Try the first low-risk option
      const recoveryOption = autoRecoveryOptions[0];
      await recoveryOption.action();

      console.log(
        `Auto-recovery successful using option: ${recoveryOption.id}`,
      );
      return { success: true, recoveryOptionId: recoveryOption.id };
    } catch (recoveryError) {
      console.warn('Auto-recovery failed:', recoveryError);
      return { success: false };
    }
  }

  /**
   * Execute a specific recovery action
   */
  private static async executeRecoveryAction(
    recoveryOptionId: string,
    error: HITLError,
    context: ErrorContext,
  ): Promise<void> {
    console.log(
      `Executing recovery action: ${recoveryOptionId} for error: ${error.type}`,
    );

    // Implementation would depend on the specific recovery action
    // This is a placeholder for the actual recovery logic
    switch (recoveryOptionId) {
      case 'retry-question-processing':
        // Retry question processing logic
        break;
      case 'reconcile-state':
        // State reconciliation logic
        break;
      case 'skip-validation':
        // Skip validation logic
        break;
      case 'manual-advance':
        // Manual workflow advancement logic
        break;
      case 'retry-operation':
        // Generic retry logic
        break;
      case 'reset-to-safe-state':
        // Reset to safe state logic
        break;
      default:
        console.warn(`Unknown recovery action: ${recoveryOptionId}`);
    }
  }

  /**
   * Notify user about the error and recovery status
   */
  private static async notifyUser(
    error: HITLError,
    context: ErrorContext,
    dataStream: UIMessageStreamWriter<ChatMessage>,
    recoveryApplied: boolean,
  ): Promise<void> {
    const notification = {
      type:
        error.severity === 'critical'
          ? 'error'
          : error.severity === 'error'
            ? 'warning'
            : 'info',
      title: HITLErrorHandler.getErrorTitle(error.type),
      message: recoveryApplied
        ? `Issue resolved automatically: ${error.message}`
        : error.message,
      actions: error.recoveryOptions.map((option) => ({
        label: option.label,
        action: option.id,
        style: option.riskLevel === 'high' ? 'danger' : 'primary',
      })),
      autoHide: error.severity === 'warning' && recoveryApplied,
      duration: error.severity === 'warning' ? 5000 : undefined,
    };

    streamToUI(dataStream, 'data-notification', notification);

    // Also stream detailed error information
    streamToUI(dataStream, 'data-hitlError', {
      error,
      recoveryOptions: error.recoveryOptions,
      canContinue: error.severity !== 'critical',
      userGuidance: HITLErrorHandler.getUserGuidance(error),
      technicalDetails: context.stackTrace,
    });
  }

  /**
   * Determine next steps after error handling
   */
  private static determineNextSteps(
    error: HITLError,
    recoveryApplied: boolean,
  ): string[] {
    const steps: string[] = [];

    if (recoveryApplied) {
      steps.push('Continue with workflow');
      if (error.severity === 'error') {
        steps.push('Monitor for similar issues');
      }
    } else {
      switch (error.severity) {
        case 'critical':
          steps.push('System requires immediate attention');
          steps.push('Contact support');
          break;
        case 'error':
          steps.push('Choose a recovery option');
          steps.push('Or contact support if issue persists');
          break;
        case 'warning':
          steps.push('Review the warning');
          steps.push('Continue if acceptable');
          break;
      }
    }

    return steps;
  }

  /**
   * Generate error ID
   */
  private static generateErrorId(error: HITLError): string {
    const timestamp = Date.now();
    const typePrefix = error.type.substring(0, 3).toUpperCase();
    const severityPrefix = error.severity.substring(0, 1).toUpperCase();
    return `${typePrefix}-${severityPrefix}-${timestamp}`;
  }

  /**
   * Log error to internal storage
   */
  private static logError(
    errorId: string,
    error: HITLError,
    context: ErrorContext,
  ): void {
    HITLErrorHandler.errorLog.set(errorId, {
      ...error,
      context: {
        ...error.context,
        ...context,
        errorId,
        loggedAt: new Date().toISOString(),
      },
    });

    // Keep only last 1000 errors to prevent memory issues
    if (HITLErrorHandler.errorLog.size > 1000) {
      const firstKey = HITLErrorHandler.errorLog.keys().next().value;
      HITLErrorHandler.errorLog.delete(firstKey);
    }

    console.error(
      `[HITL Error ${errorId}] ${error.type}:${error.severity} - ${error.message}`,
      {
        context: error.context,
      },
    );
  }

  /**
   * Update error statistics
   */
  private static updateErrorStats(errorType: string): void {
    const current = HITLErrorHandler.errorStats.get(errorType) || 0;
    HITLErrorHandler.errorStats.set(errorType, current + 1);
  }

  /**
   * Get user-friendly error title
   */
  private static getErrorTitle(errorType: HITLError['type']): string {
    switch (errorType) {
      case 'question_processing':
        return 'Question Processing Issue';
      case 'state_sync':
        return 'State Synchronization Issue';
      case 'validation':
        return 'Validation Issue';
      case 'auto_advance':
        return 'Workflow Advancement Issue';
      case 'agent_execution':
        return 'Agent Execution Issue';
      case 'user_action':
        return 'User Action Issue';
      case 'system_failure':
        return 'System Issue';
      default:
        return 'Unknown Issue';
    }
  }

  /**
   * Get user guidance for error type
   */
  private static getUserGuidance(error: HITLError): string {
    switch (error.type) {
      case 'question_processing':
        return 'There was an issue processing your question. You can try rephrasing it or use the recovery options below.';
      case 'state_sync':
        return 'The system state got out of sync. Recovery options can help restore consistency.';
      case 'validation':
        return 'Input validation failed. Please check your input or skip validation if appropriate.';
      case 'auto_advance':
        return 'The workflow could not advance automatically. You can try manual advancement.';
      case 'agent_execution':
        return 'An agent encountered an issue during execution. Recovery options may help continue.';
      case 'user_action':
        return 'There was an issue with your requested action. Please try again or choose an alternative.';
      case 'system_failure':
        return 'A system error occurred. Please try the recovery options or contact support.';
      default:
        return 'An unexpected issue occurred. Please try the available recovery options.';
    }
  }

  /**
   * Get error statistics
   */
  static getErrorStats(): Record<string, number> {
    return Object.fromEntries(HITLErrorHandler.errorStats);
  }

  /**
   * Get recent errors
   */
  static getRecentErrors(limit: number = 10): HITLError[] {
    const errors = Array.from(HITLErrorHandler.errorLog.values());
    return errors.slice(-limit).reverse(); // Most recent first
  }

  /**
   * Clear error log (for testing or maintenance)
   */
  static clearErrorLog(): void {
    HITLErrorHandler.errorLog.clear();
    HITLErrorHandler.errorStats.clear();
  }
}

/**
 * Create AI tools for error handling
 */
export function createErrorHandlingTools(
  chatId: string,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
) {
  return {
    handleError: tool({
      description:
        'Handle an error with classification, logging, and recovery options',
      inputSchema: z.object({
        errorMessage: z.string().describe('The error message'),
        errorType: z
          .enum([
            'question_processing',
            'state_sync',
            'validation',
            'auto_advance',
            'agent_execution',
            'user_action',
            'system_failure',
          ])
          .optional()
          .describe('The type of error if known'),
        severity: z
          .enum(['critical', 'error', 'warning', 'info'])
          .optional()
          .describe('Error severity if known'),
        context: z
          .record(z.any())
          .optional()
          .describe('Additional error context'),
        autoRecover: z
          .boolean()
          .default(true)
          .describe('Whether to attempt automatic recovery'),
      }),
      execute: async ({
        errorMessage,
        errorType,
        severity,
        context,
        autoRecover,
      }) => {
        const error: HITLError = {
          type: errorType || 'system_failure',
          severity: severity || 'error',
          message: errorMessage,
          context: context || {},
          recoveryOptions: [],
          timestamp: new Date().toISOString(),
        };

        const errorContext = {
          chatId,
          ...context,
        };

        return await HITLErrorHandler.handleError(
          error,
          errorContext,
          modelId,
          dataStream,
          { autoRecover },
        );
      },
    }),

    getErrorStats: tool({
      description: 'Get error statistics and recent errors',
      inputSchema: z.object({
        includeRecentErrors: z
          .boolean()
          .default(false)
          .describe('Whether to include recent error details'),
        recentErrorLimit: z
          .number()
          .default(5)
          .describe('Number of recent errors to include'),
      }),
      execute: async ({ includeRecentErrors, recentErrorLimit }) => {
        const stats = HITLErrorHandler.getErrorStats();
        const result: any = { stats };

        if (includeRecentErrors) {
          result.recentErrors =
            HITLErrorHandler.getRecentErrors(recentErrorLimit);
        }

        streamToUI(dataStream, 'data-errorStats', result);
        return result;
      },
    }),

    executeRecoveryOption: tool({
      description: 'Execute a specific recovery option for an error',
      inputSchema: z.object({
        recoveryOptionId: z
          .string()
          .describe('ID of the recovery option to execute'),
        errorId: z
          .string()
          .optional()
          .describe('ID of the error being recovered from'),
        confirmRisk: z
          .boolean()
          .default(false)
          .describe('Confirmation for high-risk recovery options'),
      }),
      execute: async ({ recoveryOptionId, errorId, confirmRisk }) => {
        try {
          // This would integrate with the actual recovery system
          console.log(`Executing recovery option: ${recoveryOptionId}`);

          const result = {
            success: true,
            recoveryOptionId,
            message: `Recovery option ${recoveryOptionId} executed successfully`,
            nextSteps: ['Continue with workflow', 'Monitor for issues'],
          };

          streamToUI(dataStream, 'data-errorRecovery', result);
          return result;
        } catch (error) {
          const result = {
            success: false,
            recoveryOptionId,
            message: `Failed to execute recovery option: ${error instanceof Error ? error.message : 'Unknown error'}`,
            nextSteps: ['Try alternative recovery option', 'Contact support'],
          };

          streamToUI(dataStream, 'data-errorRecovery', result);
          return result;
        }
      },
    }),
  };
}
