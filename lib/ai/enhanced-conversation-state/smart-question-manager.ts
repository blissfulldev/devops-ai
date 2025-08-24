import type {
  ClarificationRequest,
  ClarificationResponse,
  ChatMessage,
} from '@/lib/types';
import type { UIMessageStreamWriter } from 'ai';
import type { ChatModel } from '@/lib/ai/models';
import type {
  QuestionHistoryEntry,
  QuestionMatch,
  AnswerValidation,
  EnrichedClarificationRequest,
  ContextualHelp,
} from './types';
import * as QuestionHistoryManager from './question-history-manager';
import {
  AISDKIntegration,
  AISchemas,
  AIToolFactory,
} from './ai-sdk-integration';
import { z } from 'zod';

/**
 * Process a clarification request with AI-powered deduplication and enrichment
 */
export async function processQuestion(
  chatId: string,
  question: ClarificationRequest,
  modelId: ChatModel['id'],
  dataStream: UIMessageStreamWriter<ChatMessage>,
  options: {
    enableDeduplication?: boolean;
    enableEnrichment?: boolean;
    confidenceThreshold?: number;
    userLevel?: 'beginner' | 'intermediate' | 'advanced';
  } = {},
): Promise<{
  shouldAsk: boolean;
  processedQuestion?: EnrichedClarificationRequest;
  reusedAnswer?: ClarificationResponse;
  reasoning: string;
}> {
  const {
    enableDeduplication = true,
    enableEnrichment = true,
    confidenceThreshold = 0.8,
    userLevel = 'intermediate',
  } = options;

  try {
    // Step 1: Check for question deduplication
    let reusedAnswer: ClarificationResponse | undefined;
    let shouldAsk = true;
    let reasoning = 'New question, needs to be asked';

    if (enableDeduplication) {
      const deduplicationResult = await checkQuestionDeduplication(
        chatId,
        question,
        modelId,
        confidenceThreshold,
      );

      if (deduplicationResult.canReuse) {
        shouldAsk = false;
        reusedAnswer = deduplicationResult.match?.previousAnswer;
        reasoning = `Question is similar to a previous one (confidence: ${deduplicationResult.match?.confidence}). Reusing previous answer.`;

        // Stream reuse notification to UI
        AISDKIntegration.streamToUI(dataStream, 'data-questionReuse', {
          originalQuestion: question,
          matchedQuestion: deduplicationResult.match,
          reusedAnswer,
        });

        return {
          shouldAsk,
          reusedAnswer,
          reasoning,
        };
      }
    }

    // Step 2: Enrich the question if needed
    let processedQuestion: EnrichedClarificationRequest;

    if (enableEnrichment) {
      processedQuestion = await enrichQuestion(question, modelId, userLevel);
    } else {
      processedQuestion = createBasicEnrichedQuestion(question);
    }

    // Step 3: Add to question history
    const questionHash = QuestionHistoryManager.generateQuestionHash(
      processedQuestion.question,
      processedQuestion.context,
    );
    processedQuestion.hash = questionHash;

    QuestionHistoryManager.addQuestion(
      chatId,
      processedQuestion,
      processedQuestion.context,
    );

    return {
      shouldAsk,
      processedQuestion,
      reasoning,
    };
  } catch (error) {
    console.error('Failed to process question:', error);
    return {
      shouldAsk: true,
      processedQuestion: createBasicEnrichedQuestion(question),
      reasoning: 'Error during processing, asking question as-is',
    };
  }
}

/**
 * Check if question can be deduplicated using AI-powered similarity analysis
 */
async function checkQuestionDeduplication(
  chatId: string,
  question: ClarificationRequest,
  modelId: ChatModel['id'],
  confidenceThreshold: number,
): Promise<{
  canReuse: boolean;
  match?: QuestionMatch;
  reasoning: string;
}> {
  try {
    // Get all previous questions
    const allQuestions = QuestionHistoryManager.getAllQuestions(chatId);
    const answeredQuestions = allQuestions.filter((q) => q.answer);

    if (answeredQuestions.length === 0) {
      return {
        canReuse: false,
        reasoning: 'No previous questions to compare against',
      };
    }

    // Find the most similar question using AI
    let bestMatch: QuestionHistoryEntry | null = null;
    let bestSimilarity = 0;
    let bestSimilarityAnalysis: any = null;

    for (const prevQuestion of answeredQuestions) {
      const similarity = await AISDKIntegration.generateStructuredAnalysis(
        modelId,
        AISchemas.questionSimilarity,
        `Compare these two questions for similarity:
         
         New Question: "${question.question}"
         Context: "${question.context}"
         
         Previous Question: "${prevQuestion.question}"
         Context: "${prevQuestion.context}"
         Previous Answer: "${prevQuestion.answer?.answer || 'No answer'}"
         
         Determine if these questions are asking for the same information and if the previous answer would be applicable to the new question.`,
        'You are an expert at analyzing question similarity and determining when answers can be reused.',
      );

      if (similarity.similarity > bestSimilarity) {
        bestSimilarity = similarity.similarity;
        bestMatch = prevQuestion;
        bestSimilarityAnalysis = similarity;
      }
    }

    // Check if we found a good enough match
    if (
      bestMatch &&
      bestSimilarity >= confidenceThreshold &&
      bestMatch.answer
    ) {
      const match: QuestionMatch = {
        questionId: bestMatch.id,
        similarity: bestSimilarity,
        previousAnswer: bestMatch.answer || {
          answer: '',
          providedAt: new Date().toISOString(),
        },
        isReusable: true,
        confidence: bestSimilarityAnalysis.confidence,
      };

      return {
        canReuse: true,
        match,
        reasoning: bestSimilarityAnalysis.reasoning,
      };
    }

    return {
      canReuse: false,
      reasoning: `No sufficiently similar questions found (best similarity: ${bestSimilarity})`,
    };
  } catch (error) {
    console.warn('Failed to check question deduplication:', error);
    return {
      canReuse: false,
      reasoning: 'Error during deduplication check',
    };
  }
}

/**
 * Enrich question with AI-generated context and examples
 */
async function enrichQuestion(
  question: ClarificationRequest,
  modelId: ChatModel['id'],
  userLevel: string,
): Promise<EnrichedClarificationRequest> {
  try {
    const enrichmentSchema = z.object({
      enrichedQuestion: z.string(),
      explanation: z.string(),
      whyAsked: z.string(),
      howUsed: z.string(),
      examples: z.array(z.string()),
      relatedConcepts: z.array(z.string()),
      validationRules: z.array(
        z.object({
          type: z.enum(['required', 'format', 'range', 'custom']),
          rule: z.string(),
          errorMessage: z.string(),
          severity: z.enum(['error', 'warning']),
        }),
      ),
    });

    const enrichment = await AISDKIntegration.generateStructuredAnalysis(
      modelId,
      enrichmentSchema,
      `Enrich this clarification question for a ${userLevel} user:
       
       Original Question: "${question.question}"
       Context: "${question.context}"
       Priority: ${question.priority}
       Agent: ${question.agentName}
       
       Make the question clearer and provide helpful context, examples, and validation rules.`,
      'You are an expert at making technical questions clear and actionable.',
    );

    const contextualHelp: ContextualHelp = {
      explanation: enrichment.explanation,
      whyAsked: enrichment.whyAsked,
      howUsed: enrichment.howUsed,
      relatedConcepts: enrichment.relatedConcepts,
      documentationLinks: [], // Could be enhanced with actual links
    };

    return {
      ...question,
      hash: '', // Will be set by caller
      question: enrichment.enrichedQuestion,
      dependencies: [],
      relatedQuestions: [],
      validationRules: enrichment.validationRules,
      contextualHelp,
      examples: enrichment.examples,
      followUpActions: [],
    };
  } catch (error) {
    console.warn('Failed to enrich question:', error);
    return createBasicEnrichedQuestion(question);
  }
}

/**
 * Create basic enriched question without AI enhancement (fallback)
 */
function createBasicEnrichedQuestion(
  question: ClarificationRequest,
): EnrichedClarificationRequest {
  const contextualHelp: ContextualHelp = {
    explanation: `This question is part of the ${question.agentName} workflow.`,
    whyAsked: 'This information is needed to proceed with the workflow.',
    howUsed: 'Your answer will be used in the next steps.',
    relatedConcepts: [],
    documentationLinks: [],
  };

  return {
    ...question,
    hash: '',
    dependencies: [],
    relatedQuestions: [],
    validationRules: [],
    contextualHelp,
    examples: question.options || [],
    followUpActions: [],
  };
}

/**
 * Validate answer using AI-powered analysis
 */
export async function validateAnswer(
  chatId: string,
  questionId: string,
  answer: ClarificationResponse,
  modelId: ChatModel['id'],
  dataStream: UIMessageStreamWriter<ChatMessage>,
): Promise<AnswerValidation> {
  const questionEntry = QuestionHistoryManager.getQuestion(chatId, questionId);

  if (!questionEntry) {
    return {
      isValid: false,
      confidence: 0,
      issues: [
        {
          type: 'incomplete',
          message: 'Question not found',
          severity: 'error',
        },
      ],
      suggestions: ['Please try asking the question again'],
      requiresFollowUp: false,
    };
  }

  try {
    const validation = await AISDKIntegration.generateStructuredAnalysis(
      modelId,
      AISchemas.answerValidation,
      `Validate this answer for the given question:
       Question: "${questionEntry.question}"
       Context: "${questionEntry.context}"
       Answer: "${answer.answer}"
       
       Evaluate completeness, accuracy, and usefulness.`,
      'You are an expert at validating user responses.',
    );

    // Store validation result
    QuestionHistoryManager.addAnswerToQuestion(
      chatId,
      questionId,
      answer,
      validation,
    );

    // Stream validation result to UI
    AISDKIntegration.streamToUI(
      dataStream,
      'data-answerValidation',
      validation,
    );

    return validation;
  } catch (error) {
    console.warn('Failed to validate answer:', error);
    const fallbackValidation: AnswerValidation = {
      isValid: answer.answer.trim().length > 0,
      confidence: 0.5,
      issues: [],
      suggestions: [],
      requiresFollowUp: false,
    };

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
 * Generate follow-up questions based on answer
 */
export async function generateFollowUpQuestions(
  chatId: string,
  questionId: string,
  modelId: ChatModel['id'],
): Promise<ClarificationRequest[]> {
  const questionEntry = QuestionHistoryManager.getQuestion(chatId, questionId);

  if (!questionEntry || !questionEntry.answer) {
    return [];
  }

  try {
    const followUpSchema = z.object({
      followUpQuestions: z.array(
        z.object({
          question: z.string(),
          context: z.string(),
          priority: z.enum(['low', 'medium', 'high']),
          reasoning: z.string(),
        }),
      ),
    });

    const followUp = await AISDKIntegration.generateStructuredAnalysis(
      modelId,
      followUpSchema,
      `Based on this question and answer, generate relevant follow-up questions:
       
       Original Question: "${questionEntry.question}"
       Answer: "${questionEntry.answer.answer}"
       Context: "${questionEntry.context}"
       
       What additional information might be needed based on this answer?`,
      'You are an expert at identifying information gaps and generating relevant follow-up questions.',
    );

    return followUp.followUpQuestions.map((fq, index) => ({
      id: `${questionId}_followup_${index}`,
      question: fq.question,
      context: fq.context,
      priority: fq.priority,
      agentName: questionEntry.agentName,
      options: [],
    }));
  } catch (error) {
    console.warn('Failed to generate follow-up questions:', error);
    return [];
  }
}

/**
 * Get question statistics with AI insights
 */
export function getQuestionStats(chatId: string): {
  basic: ReturnType<typeof QuestionHistoryManager.getQuestionStats>;
  aiInsights: {
    mostCommonTopics: string[];
    averageQuestionComplexity: 'low' | 'medium' | 'high';
    reusabilityRate: number;
    userEngagementLevel: 'low' | 'medium' | 'high';
  };
} {
  const basicStats = QuestionHistoryManager.getQuestionStats(chatId);
  const allQuestions = QuestionHistoryManager.getAllQuestions(chatId);

  // Calculate reusability rate
  const reusedQuestions = allQuestions.filter((q) => q.reusedCount > 0).length;
  const reusabilityRate =
    allQuestions.length > 0 ? reusedQuestions / allQuestions.length : 0;

  // Simple heuristics for AI insights (could be enhanced with actual AI analysis)
  const averageAnswerLength =
    allQuestions
      .filter((q) => q.answer)
      .reduce((sum, q) => sum + (q.answer?.answer.length || 0), 0) /
    Math.max(basicStats.answered, 1);

  const averageQuestionComplexity: 'low' | 'medium' | 'high' =
    averageAnswerLength > 200
      ? 'high'
      : averageAnswerLength > 50
        ? 'medium'
        : 'low';

  const userEngagementLevel: 'low' | 'medium' | 'high' =
    basicStats.answered / Math.max(basicStats.total, 1) > 0.8
      ? 'high'
      : basicStats.answered / Math.max(basicStats.total, 1) > 0.5
        ? 'medium'
        : 'low';

  return {
    basic: basicStats,
    aiInsights: {
      mostCommonTopics: [], // Could be enhanced with topic analysis
      averageQuestionComplexity,
      reusabilityRate,
      userEngagementLevel,
    },
  };
}

/**
 * Create AI-powered question tools for use in agents
 */
export function createQuestionTools(
  chatId: string,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
) {
  return {
    processQuestion: AIToolFactory.createQuestionProcessingTool(
      chatId,
      dataStream,
      modelId,
    ),
    validateAnswer: AIToolFactory.createAnswerValidationTool(
      chatId,
      dataStream,
      modelId,
    ),
    generateFollowUp: AIToolFactory.createFollowUpGenerationTool(
      chatId,
      dataStream,
      modelId,
    ),
  };
}
