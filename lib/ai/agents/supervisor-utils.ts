import type { ChatMessage } from '@/lib/types';

/**
 * Convert error to string with stack trace
 */
export function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.stack ?? e.message ?? String(e);
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Get the last user text from UI messages
 */
export function getLastUserText(uiMessages: ChatMessage[]): string {
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    const m = uiMessages[i] as any;
    if (m.role === 'user' && typeof m.content === 'string') {
      return m.content;
    }
  }
  return '';
}

/**
 * Extract clarification responses from UI messages
 */
export function extractClarificationResponses(
  uiMessages: ChatMessage[],
): Array<{
  questionId: string;
  answer: string;
  timestamp: string;
}> {
  const responses: Array<{
    questionId: string;
    answer: string;
    timestamp: string;
  }> = [];

  for (const message of uiMessages) {
    if (message.type === 'data' && message.data) {
      // Check for clarification response data
      if ('clarificationResponse' in message.data) {
        const response = message.data.clarificationResponse as any;
        responses.push({
          questionId: response.questionId || response.id,
          answer: response.answer || response.response,
          timestamp: response.timestamp || new Date().toISOString(),
        });
      }

      // Check for form submission data
      if ('formSubmission' in message.data) {
        const submission = message.data.formSubmission as any;
        if (submission.type === 'clarification') {
          responses.push({
            questionId: submission.questionId,
            answer: submission.answer,
            timestamp: submission.timestamp || new Date().toISOString(),
          });
        }
      }
    }
  }

  return responses;
}

/**
 * Check if messages contain clarification requests
 */
export function hasPendingClarifications(uiMessages: ChatMessage[]): boolean {
  return uiMessages.some((message) => {
    if (message.type === 'data' && message.data) {
      return (
        'clarificationRequest' in message.data ||
        'pendingClarifications' in message.data
      );
    }
    return false;
  });
}

/**
 * Extract workflow context from messages
 */
export function extractWorkflowContext(uiMessages: ChatMessage[]): {
  currentPhase?: string;
  currentAgent?: string;
  workflowStep?: string;
  completedSteps: string[];
} {
  const context = {
    completedSteps: [] as string[],
  };

  for (const message of uiMessages) {
    if (message.type === 'data' && message.data) {
      if ('workflowState' in message.data) {
        const workflowState = message.data.workflowState as any;
        Object.assign(context, {
          currentPhase: workflowState.currentPhase,
          currentAgent: workflowState.currentAgent,
          workflowStep: workflowState.workflowStep,
        });
      }

      if ('stepCompletion' in message.data) {
        const completion = message.data.stepCompletion as any;
        if (completion.status === 'completed') {
          context.completedSteps.push(completion.stepId || completion.step);
        }
      }
    }
  }

  return context;
}

/**
 * Validate supervisor agent parameters
 */
export function validateSupervisorParams(params: {
  selectedChatModel: any;
  uiMessages: ChatMessage[];
  dataStream: any;
  session?: any;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!params.selectedChatModel) {
    errors.push('selectedChatModel is required');
  }

  if (!params.uiMessages || !Array.isArray(params.uiMessages)) {
    errors.push('uiMessages must be an array');
  }

  if (!params.dataStream) {
    errors.push('dataStream is required');
  }

  if (params.uiMessages && params.uiMessages.length === 0) {
    errors.push('uiMessages cannot be empty');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Create error response for supervisor
 */
export function createErrorResponse(
  error: string,
  details?: any,
): {
  type: 'error';
  error: string;
  details?: any;
  timestamp: string;
} {
  return {
    type: 'error',
    error,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create success response for supervisor
 */
export function createSuccessResponse(
  data: any,
  message?: string,
): {
  type: 'success';
  data: any;
  message?: string;
  timestamp: string;
} {
  return {
    type: 'success',
    data,
    message,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Sanitize chat ID for logging
 */
export function sanitizeChatId(chatId: string): string {
  // Remove or mask sensitive parts of chat ID for logging
  if (chatId.length > 8) {
    return `${chatId.substring(0, 4)}...${chatId.substring(chatId.length - 4)}`;
  }
  return chatId;
}

/**
 * Calculate message processing metrics
 */
export function calculateProcessingMetrics(
  startTime: number,
  messageCount: number,
): {
  processingTime: number;
  messagesPerSecond: number;
  averageMessageTime: number;
} {
  const processingTime = Date.now() - startTime;
  const messagesPerSecond =
    messageCount > 0 ? (messageCount / processingTime) * 1000 : 0;
  const averageMessageTime =
    messageCount > 0 ? processingTime / messageCount : 0;

  return {
    processingTime,
    messagesPerSecond,
    averageMessageTime,
  };
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Deep clone object (for state manipulation)
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const cloned = {} as T;
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        cloned[key] = deepClone(obj[key]);
      }
    }
    return cloned;
  }

  return obj;
}

/**
 * Throttle function execution
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastExecTime = 0;

  return (...args: Parameters<T>) => {
    const currentTime = Date.now();

    if (currentTime - lastExecTime > delay) {
      func(...args);
      lastExecTime = currentTime;
    } else {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(
        () => {
          func(...args);
          lastExecTime = Date.now();
          timeoutId = null;
        },
        delay - (currentTime - lastExecTime),
      );
    }
  };
}

/**
 * Debounce function execution
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay);
  };
}
