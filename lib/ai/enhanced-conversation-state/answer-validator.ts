import type { ClarificationResponse, ChatMessage } from '@/lib/types';
import type { UIMessageStreamWriter } from 'ai';
import type { ChatModel } from '@/lib/ai/models';
import type {
  AnswerValidation,
  ValidationIssue,
  ValidationRule,
  QuestionHistoryEntry,
} from './types';
import { AISDKIntegration, AISchemas } from './ai-sdk-integration';
import * as QuestionHistoryManager from './question-history-manager';
import { z } from 'zod';

/**
 * Validate answer using AI-powered analysis with custom rules
 */
export async function validateAnswer(
  chatId: string,
  questionId: string,
  answer: ClarificationResponse,
  modelId: ChatModel['id'],
  dataStream: UIMessageStreamWriter<ChatMessage>,
  options: {
    customRules?: ValidationRule[];
    strictMode?: boolean;
    generateSuggestions?: boolean;
    checkFollowUp?: boolean;
  } = {},
): Promise<AnswerValidation> {
  const {
    customRules = [],
    strictMode = false,
    generateSuggestions = true,
    checkFollowUp = true,
  } = options;

  const questionEntry = QuestionHistoryManager.getQuestion(chatId, questionId);

  if (!questionEntry) {
    return createBasicValidation(answer);
  }

  try {
    // Combine built-in and custom validation rules
    const allRules = [...getBuiltInRules(questionEntry), ...customRules];

    // Perform AI-powered validation
    const aiValidation = await performAIValidation(
      questionEntry,
      answer,
      modelId,
      allRules,
      strictMode,
    );

    // Enhance with rule-based validation
    const ruleValidation = performRuleBasedValidation(answer, allRules);

    // Combine AI and rule-based results
    const combinedValidation = combineValidationResults(
      aiValidation,
      ruleValidation,
      strictMode,
    );

    // Generate suggestions if requested
    if (generateSuggestions && !combinedValidation.isValid) {
      combinedValidation.suggestions = await generateImprovementSuggestions(
        questionEntry,
        answer,
        combinedValidation.issues,
        modelId,
      );
    }

    // Check if follow-up questions are needed
    if (checkFollowUp) {
      combinedValidation.requiresFollowUp = await shouldGenerateFollowUp(
        questionEntry,
        answer,
        combinedValidation,
        modelId,
      );
    }

    // Store validation result
    QuestionHistoryManager.addAnswerToQuestion(
      chatId,
      questionId,
      answer,
      combinedValidation,
    );

    // Stream validation result to UI
    AISDKIntegration.streamToUI(
      dataStream,
      'data-appendMessage',
      JSON.stringify(combinedValidation),
    );

    return combinedValidation;
  } catch (error) {
    console.warn(
      'AI validation failed, falling back to basic validation:',
      error,
    );
    const fallbackValidation = createBasicValidation(answer);

    QuestionHistoryManager.addAnswerToQuestion(
      chatId,
      questionId,
      answer,
      fallbackValidation,
    );
    return fallbackValidation;
  }
}

/**
 * Perform AI-powered validation using structured analysis
 */
async function performAIValidation(
  question: QuestionHistoryEntry,
  answer: ClarificationResponse,
  modelId: ChatModel['id'],
  rules: ValidationRule[],
  strictMode: boolean,
): Promise<AnswerValidation> {
  const rulesDescription =
    rules.length > 0
      ? `Validation rules: ${rules.map((r) => `${r.type}: ${r.rule}`).join('; ')}`
      : 'Use general validation criteria';

  const validation = await AISDKIntegration.generateStructuredAnalysis(
    modelId,
    AISchemas.answerValidation,
    `Validate this answer for the given question:
     Question: "${question.question}"
     Context: "${question.context}"
     Answer: "${answer.answer}"
     
     ${rulesDescription}
     Strict mode: ${strictMode ? 'Yes - be very thorough' : 'No - be reasonable'}
     
     Evaluate completeness, accuracy, clarity, and usefulness of the answer.
     Consider if the answer actually addresses what was asked.`,
    'You are an expert at validating user responses. Be thorough but fair in your assessment.',
  );

  return validation;
}

/**
 * Perform rule-based validation using predefined rules
 */
function performRuleBasedValidation(
  answer: ClarificationResponse,
  rules: ValidationRule[],
): Partial<AnswerValidation> {
  const issues: ValidationIssue[] = [];
  const answerText = answer.answer.trim();

  for (const rule of rules) {
    const violation = checkRule(answerText, rule);
    if (violation) {
      issues.push(violation);
    }
  }

  return {
    isValid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}

/**
 * Check a single validation rule
 */
function checkRule(
  answerText: string,
  rule: ValidationRule,
): ValidationIssue | null {
  switch (rule.type) {
    case 'required':
      if (answerText.length === 0) {
        return {
          type: 'incomplete',
          message: rule.errorMessage,
          severity: rule.severity,
          suggestedFix: 'Please provide an answer to this question.',
        };
      }
      break;

    case 'format':
      try {
        const regex = new RegExp(rule.rule);
        if (!regex.test(answerText)) {
          return {
            type: 'invalid_format',
            message: rule.errorMessage,
            severity: rule.severity,
            suggestedFix: `Please ensure your answer matches the expected format: ${rule.rule}`,
          };
        }
      } catch (error) {
        console.warn(`Invalid regex in validation rule: ${rule.rule}`);
      }
      break;

    case 'range':
      try {
        const [min, max] = rule.rule.split('-').map(Number);
        const answerLength = answerText.length;
        if (answerLength < min || answerLength > max) {
          return {
            type: 'out_of_range',
            message: rule.errorMessage,
            severity: rule.severity,
            suggestedFix: `Answer should be between ${min} and ${max} characters. Current length: ${answerLength}`,
          };
        }
      } catch (error) {
        console.warn(`Invalid range in validation rule: ${rule.rule}`);
      }
      break;

    case 'custom':
      // Custom rules would need to be implemented based on specific requirements
      // For now, we'll skip custom rule validation
      break;
  }

  return null;
}

/**
 * Combine AI and rule-based validation results
 */
function combineValidationResults(
  aiValidation: AnswerValidation,
  ruleValidation: Partial<AnswerValidation>,
  strictMode: boolean,
): AnswerValidation {
  // Combine issues from both validations
  const allIssues = [...aiValidation.issues, ...(ruleValidation.issues || [])];

  // Remove duplicate issues
  const uniqueIssues = allIssues.filter(
    (issue, index, array) =>
      array.findIndex(
        (i) => i.type === issue.type && i.message === issue.message,
      ) === index,
  );

  // Determine overall validity
  const hasErrors = uniqueIssues.some((i) => i.severity === 'error');
  const hasWarnings = uniqueIssues.some((i) => i.severity === 'warning');

  let isValid: boolean;
  if (strictMode) {
    isValid = !hasErrors && !hasWarnings;
  } else {
    isValid = !hasErrors;
  }

  // Calculate combined confidence
  const ruleBasedConfidence = ruleValidation.isValid ? 0.9 : 0.3;
  const combinedConfidence =
    (aiValidation.confidence + ruleBasedConfidence) / 2;

  return {
    isValid,
    confidence: Math.min(combinedConfidence, 1.0),
    issues: uniqueIssues,
    suggestions: aiValidation.suggestions,
    requiresFollowUp: aiValidation.requiresFollowUp,
  };
}

/**
 * Generate improvement suggestions for invalid answers
 */
async function generateImprovementSuggestions(
  question: QuestionHistoryEntry,
  answer: ClarificationResponse,
  issues: ValidationIssue[],
  modelId: ChatModel['id'],
): Promise<string[]> {
  try {
    const issueDescriptions = issues
      .map((i) => `${i.type}: ${i.message}`)
      .join('; ');

    const suggestions = await AISDKIntegration.generateStructuredAnalysis(
      modelId,
      z.object({
        suggestions: z.array(z.string()),
        reasoning: z.string(),
      }),
      `Generate helpful suggestions to improve this answer:
       Question: "${question.question}"
       Current Answer: "${answer.answer}"
       Issues Found: ${issueDescriptions}
       
       Provide 2-4 specific, actionable suggestions that would help the user provide a better answer.`,
      'You are an expert at providing constructive feedback. Be specific and helpful.',
    );

    return suggestions.suggestions;
  } catch (error) {
    console.warn('Failed to generate improvement suggestions:', error);
    return issues.map((i) => i.suggestedFix).filter(Boolean) as string[];
  }
}

/**
 * Determine if follow-up questions should be generated
 */
async function shouldGenerateFollowUp(
  question: QuestionHistoryEntry,
  answer: ClarificationResponse,
  validation: AnswerValidation,
  modelId: ChatModel['id'],
): Promise<boolean> {
  // Don't generate follow-up if answer is invalid
  if (!validation.isValid) {
    return false;
  }

  // Don't generate follow-up if confidence is very high
  if (validation.confidence > 0.9) {
    return false;
  }

  try {
    const followUpAnalysis = await AISDKIntegration.generateStructuredAnalysis(
      modelId,
      z.object({
        needsFollowUp: z.boolean(),
        reasoning: z.string(),
        suggestedQuestions: z.array(z.string()).optional(),
      }),
      `Analyze if this answer needs follow-up questions:
       Question: "${question.question}"
       Answer: "${answer.answer}"
       Context: "${question.context}"
       
       Determine if the answer is complete enough or if additional clarification would be helpful.`,
      'You are an expert at determining when additional questions are needed to gather complete information.',
    );

    return followUpAnalysis.needsFollowUp;
  } catch (error) {
    console.warn('Failed to analyze follow-up need:', error);
    // Default heuristic: require follow-up if confidence is low
    return validation.confidence < 0.7;
  }
}

/**
 * Get built-in validation rules based on question characteristics
 */
function getBuiltInRules(question: QuestionHistoryEntry): ValidationRule[] {
  const rules: ValidationRule[] = [];

  // Always require non-empty answers
  rules.push({
    type: 'required',
    rule: 'non-empty',
    errorMessage: 'Answer cannot be empty',
    severity: 'error',
  });

  // Add context-specific rules based on question content
  const questionLower = question.question.toLowerCase();

  if (questionLower.includes('email')) {
    rules.push({
      type: 'format',
      rule: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      errorMessage: 'Please provide a valid email address',
      severity: 'error',
    });
  }

  if (questionLower.includes('url') || questionLower.includes('website')) {
    rules.push({
      type: 'format',
      rule: '^https?://.+',
      errorMessage:
        'Please provide a valid URL starting with http:// or https://',
      severity: 'warning',
    });
  }

  if (questionLower.includes('number') || questionLower.includes('count')) {
    rules.push({
      type: 'format',
      rule: '^\\d+$',
      errorMessage: 'Please provide a valid number',
      severity: 'error',
    });
  }

  if (questionLower.includes('yes') && questionLower.includes('no')) {
    rules.push({
      type: 'format',
      rule: '^(yes|no|y|n)$',
      errorMessage: 'Please answer with yes/no or y/n',
      severity: 'warning',
    });
  }

  // Add length constraints for detailed questions
  if (questionLower.includes('describe') || questionLower.includes('explain')) {
    rules.push({
      type: 'range',
      rule: '10-1000',
      errorMessage: 'Description should be between 10 and 1000 characters',
      severity: 'warning',
    });
  }

  return rules;
}

/**
 * Create basic validation for fallback scenarios
 */
function createBasicValidation(
  answer: ClarificationResponse,
): AnswerValidation {
  const answerText = answer.answer.trim();
  const isEmpty = answerText.length === 0;

  return {
    isValid: !isEmpty,
    confidence: isEmpty ? 0.1 : 0.7,
    issues: isEmpty
      ? [
          {
            type: 'incomplete',
            message: 'Answer appears to be empty',
            severity: 'error',
            suggestedFix: 'Please provide an answer to this question.',
          },
        ]
      : [],
    suggestions: isEmpty
      ? ['Please provide a complete answer to the question.']
      : [],
    requiresFollowUp: false,
  };
}

/**
 * Validate multiple answers in batch
 */
export async function validateAnswersBatch(
  chatId: string,
  answerPairs: Array<{ questionId: string; answer: ClarificationResponse }>,
  modelId: ChatModel['id'],
  dataStream: UIMessageStreamWriter<ChatMessage>,
): Promise<AnswerValidation[]> {
  const validations: AnswerValidation[] = [];

  for (const { questionId, answer } of answerPairs) {
    try {
      const validation = await validateAnswer(
        chatId,
        questionId,
        answer,
        modelId,
        dataStream,
      );
      validations.push(validation);
    } catch (error) {
      console.warn(
        `Failed to validate answer for question ${questionId}:`,
        error,
      );
      validations.push(createBasicValidation(answer));
    }
  }

  return validations;
}

/**
 * Get validation statistics for a chat
 */
export function getValidationStats(chatId: string): {
  totalValidated: number;
  validAnswers: number;
  invalidAnswers: number;
  averageConfidence: number;
  commonIssues: Array<{ type: string; count: number }>;
} {
  const allQuestions = QuestionHistoryManager.getAllQuestions(chatId);
  const validatedQuestions = allQuestions.filter(
    (q: QuestionHistoryEntry) => q.validationResult,
  );

  const validAnswers = validatedQuestions.filter(
    (q: QuestionHistoryEntry) => q.validationResult?.isValid,
  ).length;
  const invalidAnswers = validatedQuestions.length - validAnswers;

  const totalConfidence = validatedQuestions.reduce(
    (sum: number, q: QuestionHistoryEntry) =>
      sum + (q.validationResult?.confidence || 0),
    0,
  );
  const averageConfidence =
    validatedQuestions.length > 0
      ? totalConfidence / validatedQuestions.length
      : 0;

  // Count issue types
  const issueTypeCounts: Record<string, number> = {};
  validatedQuestions.forEach((q: QuestionHistoryEntry) => {
    q.validationResult?.issues.forEach((issue: ValidationIssue) => {
      issueTypeCounts[issue.type] = (issueTypeCounts[issue.type] || 0) + 1;
    });
  });

  const commonIssues = Object.entries(issueTypeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalValidated: validatedQuestions.length,
    validAnswers,
    invalidAnswers,
    averageConfidence,
    commonIssues,
  };
}

/**
 * Generate AI-powered follow-up questions to help improve inadequate answers
 */
export async function generateFollowUpQuestions(
  originalQuestion: string,
  inadequateAnswer: string,
  context: string,
  validationResult: AnswerValidation,
): Promise<string[]> {
  try {
    const followUpAnalysis = await AISDKIntegration.generateStructuredAnalysis(
      'gpt-4',
      z.object({
        followUpQuestions: z.array(z.string()).max(5),
        reasoning: z.string(),
        improvementAreas: z.array(z.string()),
      }),
      `Generate intelligent follow-up questions to help the user provide a better answer.

Original Question: "${originalQuestion}"
Context: "${context}"
User's Answer: "${inadequateAnswer}"

Validation Issues:
${validationResult.issues?.map((issue) => `- ${issue.type}: ${issue.message}`).join('\n') || 'No specific issues identified'}

Generate 2-4 specific follow-up questions that will help the user:
1. Address the validation issues
2. Provide more complete information
3. Clarify ambiguous parts of their answer
4. Consider important aspects they may have missed

Make the questions:
- Specific and actionable
- Easy to understand
- Focused on the gaps in their current answer
- Helpful for improving answer quality`,
      `You are an expert at helping users provide better answers to clarification questions.
      Generate follow-up questions that guide users toward more complete, accurate, and useful responses.
      Focus on the specific deficiencies in their current answer.`,
    );

    return followUpAnalysis.followUpQuestions;
  } catch (error) {
    console.error('Failed to generate follow-up questions:', error);

    // Fallback to basic follow-up questions based on validation issues
    const fallbackQuestions: string[] = [];

    if (validationResult.issues) {
      for (const issue of validationResult.issues) {
        switch (issue.type) {
          case 'incomplete':
            fallbackQuestions.push(
              'Could you provide more details about your answer?',
            );
            break;
          case 'invalid_format':
            fallbackQuestions.push(
              'Could you reformat your answer according to the requirements?',
            );
            break;
          case 'out_of_range':
            fallbackQuestions.push(
              'Could you adjust the length of your answer?',
            );
            break;
          case 'ambiguous':
            fallbackQuestions.push(
              'Could you clarify what you mean in your answer?',
            );
            break;
          default:
            fallbackQuestions.push('Could you provide a more specific answer?');
        }
      }
    }

    if (fallbackQuestions.length === 0) {
      fallbackQuestions.push(
        'Could you provide more information to help us understand your answer better?',
      );
    }

    return fallbackQuestions.slice(0, 3); // Limit to 3 fallback questions
  }
}
