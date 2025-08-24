import crypto from 'node:crypto';
import type { ClarificationRequest, ClarificationResponse } from '@/lib/types';
import type { AgentName } from '../conversation-state';
import type {
  QuestionHistoryEntry,
  QuestionMatch,
  AnswerValidation,
} from './types';
import { EnhancedStateManager } from './enhanced-state-manager';

/**
 * Question History Manager functions for question deduplication and history tracking
 */
/**
 * Generate a hash for question content to enable deduplication
 */
export function generateQuestionHash(
  question: string,
  context: string,
): string {
  const content = `${question.toLowerCase().trim()}|${context.toLowerCase().trim()}`;
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Add a question to the history with hash-based deduplication
 */
export function addQuestion(
  chatId: string,
  question: ClarificationRequest,
  context?: string,
): {
  hash: string;
  isDuplicate: boolean;
  existingEntry?: QuestionHistoryEntry;
} {
  const hash = generateQuestionHash(
    question.question,
    context || question.context,
  );

  // Check for existing similar questions
  const similarQuestions = findSimilarQuestions(chatId, hash);
  const isDuplicate = similarQuestions.length > 0;

  if (isDuplicate) {
    const existingEntry = similarQuestions[0];
    // Mark as reused
    EnhancedStateManager.markQuestionReused(chatId, existingEntry.id);

    return {
      hash,
      isDuplicate: true,
      existingEntry,
    };
  }

  // Add new question to history
  EnhancedStateManager.addQuestionToHistory(chatId, question, hash);

  return {
    hash,
    isDuplicate: false,
  };
}

/**
 * Find similar questions based on hash
 */
export function findSimilarQuestions(
  chatId: string,
  hash: string,
): QuestionHistoryEntry[] {
  return EnhancedStateManager.findSimilarQuestions(chatId, hash);
}

/**
 * Check if a question should reuse a previous answer
 */
export function shouldReuseAnswer(
  chatId: string,
  questionHash: string,
  confidenceThreshold = 0.8,
): { shouldReuse: boolean; match?: QuestionMatch } {
  const similarQuestions = findSimilarQuestions(chatId, questionHash);

  if (similarQuestions.length === 0) {
    return { shouldReuse: false };
  }

  // Find the best match with a valid answer
  const bestMatch = similarQuestions.find(
    (entry) =>
      entry.answer &&
      entry.validationResult?.isValid !== false &&
      (entry.validationResult?.confidence ?? 0) >= confidenceThreshold,
  );

  if (!bestMatch || !bestMatch.answer) {
    return { shouldReuse: false };
  }

  const match: QuestionMatch = {
    questionId: bestMatch.id,
    similarity: 1.0, // Exact hash match
    previousAnswer: bestMatch.answer,
    isReusable: true,
    confidence: bestMatch.validationResult?.confidence || 0.9,
  };

  return {
    shouldReuse: true,
    match,
  };
}

/**
 * Update question history with answer
 */
export function addAnswerToQuestion(
  chatId: string,
  questionId: string,
  answer: ClarificationResponse,
  validation?: AnswerValidation,
): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      const entry = state.questionHistory.get(questionId);
      if (entry) {
        entry.answer = answer;
        if (validation) {
          entry.validationResult = validation;
        }
      }
    },
    `Added answer to question: ${questionId}`,
  );

  if (validation) {
    EnhancedStateManager.addAnswerValidation(chatId, questionId, validation);
  }
}

/**
 * Get question history entry by ID
 */
export function getQuestion(
  chatId: string,
  questionId: string,
): QuestionHistoryEntry | undefined {
  return EnhancedStateManager.getQuestionFromHistory(chatId, questionId);
}

/**
 * Get all questions from history
 */
export function getAllQuestions(chatId: string): QuestionHistoryEntry[] {
  const state = EnhancedStateManager.getEnhancedState(chatId);
  return Array.from(state.questionHistory.values());
}

/**
 * Get questions by agent
 */
export function getQuestionsByAgent(
  chatId: string,
  agentName: AgentName,
): QuestionHistoryEntry[] {
  const allQuestions = getAllQuestions(chatId);
  return allQuestions.filter((q) => q.agentName === agentName);
}

/**
 * Get unanswered questions
 */
export function getUnansweredQuestions(chatId: string): QuestionHistoryEntry[] {
  const allQuestions = getAllQuestions(chatId);
  return allQuestions.filter((q) => !q.answer);
}

/**
 * Get questions that were reused
 */
export function getReusedQuestions(chatId: string): QuestionHistoryEntry[] {
  const allQuestions = getAllQuestions(chatId);
  return allQuestions.filter((q) => q.reusedCount > 0);
}

/**
 * Add dependency relationship between questions
 */
export function addQuestionDependency(
  chatId: string,
  questionId: string,
  dependsOnQuestionId: string,
): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      const entry = state.questionHistory.get(questionId);
      if (entry && !entry.dependencies.includes(dependsOnQuestionId)) {
        entry.dependencies.push(dependsOnQuestionId);
      }

      // Also update the dependencies map
      const deps = state.questionDependencies.get(questionId) || [];
      if (!deps.includes(dependsOnQuestionId)) {
        deps.push(dependsOnQuestionId);
        state.questionDependencies.set(questionId, deps);
      }
    },
    `Added dependency: ${questionId} depends on ${dependsOnQuestionId}`,
  );
}

/**
 * Check if question dependencies are satisfied
 */
export function areDependenciesSatisfied(
  chatId: string,
  questionId: string,
): boolean {
  const entry = getQuestion(chatId, questionId);
  if (!entry || entry.dependencies.length === 0) {
    return true;
  }

  // Check if all dependency questions have valid answers
  return entry.dependencies.every((depId) => {
    const depEntry = getQuestion(chatId, depId);
    return depEntry?.answer && depEntry.validationResult?.isValid !== false;
  });
}

/**
 * Get questions that are ready to be asked (dependencies satisfied)
 */
export function getReadyQuestions(chatId: string): QuestionHistoryEntry[] {
  const unanswered = getUnansweredQuestions(chatId);
  return unanswered.filter((q) => areDependenciesSatisfied(chatId, q.id));
}

/**
 * Get question statistics
 */
export function getQuestionStats(chatId: string): {
  total: number;
  answered: number;
  unanswered: number;
  reused: number;
  byAgent: Record<AgentName, number>;
} {
  const allQuestions = getAllQuestions(chatId);
  const answered = allQuestions.filter((q) => q.answer).length;
  const reused = allQuestions.filter((q) => q.reusedCount > 0).length;

  const byAgent: Record<AgentName, number> = {
    core_agent: 0,
    diagram_agent: 0,
    terraform_agent: 0,
  };

  allQuestions.forEach((q) => {
    if (q.agentName in byAgent) {
      byAgent[q.agentName as AgentName]++;
    }
  });

  return {
    total: allQuestions.length,
    answered,
    unanswered: allQuestions.length - answered,
    reused,
    byAgent,
  };
}

/**
 * Clear old questions from history (keep last N questions)
 */
export function cleanupOldQuestions(chatId: string, keepCount = 100): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      const allQuestions = Array.from(state.questionHistory.values());

      if (allQuestions.length <= keepCount) {
        return; // No cleanup needed
      }

      // Sort by timestamp and keep the most recent ones
      allQuestions.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      const toKeep = allQuestions.slice(0, keepCount);
      const toRemove = allQuestions.slice(keepCount);

      // Clear old entries
      state.questionHistory.clear();
      toKeep.forEach((entry) => {
        state.questionHistory.set(entry.id, entry);
      });

      // Clean up related maps
      toRemove.forEach((entry) => {
        state.answerValidationResults.delete(entry.id);
        state.questionDependencies.delete(entry.id);
      });

      console.log(
        `Cleaned up ${toRemove.length} old questions, kept ${toKeep.length}`,
      );
    },
    `Cleaned up old questions, kept ${keepCount} most recent`,
  );
}
