import type { ClarificationRequest, ChatMessage } from '@/lib/types';
import type { UIMessageStreamWriter } from 'ai';
import type { ChatModel } from '@/lib/ai/models';
import type {
  EnrichedClarificationRequest,
  ContextualHelp,
  ValidationRule,
} from './types';
import { AISDKIntegration } from './ai-sdk-integration';
import * as QuestionHistoryManager from './question-history-manager';
import { z } from 'zod';

/**
 * Enrich a clarification request with AI-generated context and examples
 */
export async function enrichQuestion(
  question: ClarificationRequest,
  modelId: ChatModel['id'],
  dataStream: UIMessageStreamWriter<ChatMessage>,
  options: {
    userLevel?: 'beginner' | 'intermediate' | 'advanced';
    domain?: string;
    includeExamples?: boolean;
    includeValidationRules?: boolean;
    maxExamples?: number;
  } = {},
): Promise<EnrichedClarificationRequest> {
  const {
    userLevel = 'intermediate',
    domain = 'general',
    includeExamples = true,
    includeValidationRules = true,
    maxExamples = 3,
  } = options;

  try {
    // Generate AI-powered enrichment
    const enrichment = await generateAIEnrichment(
      question,
      modelId,
      userLevel,
      domain,
      includeExamples,
      maxExamples,
    );

    // Create contextual help
    const contextualHelp = createContextualHelp(enrichment, question);

    // Generate validation rules if requested
    const validationRules = includeValidationRules
      ? await generateValidationRules(question, modelId)
      : [];

    // Detect related questions and dependencies
    const relatedQuestions = await findRelatedQuestions(question, modelId);
    const dependencies = detectDependencies(question);

    // Create enriched question
    const enrichedQuestion: EnrichedClarificationRequest = {
      ...question,
      hash: '', // Will be set by caller
      dependencies,
      relatedQuestions,
      validationRules,
      contextualHelp,
      examples: enrichment.examples || [],
      followUpActions: await generateFollowUpActions(question, modelId),
      question: enrichment.enrichedQuestion, // Use AI-improved question text
    };

    // Stream enriched question to UI
    AISDKIntegration.streamToUI(
      dataStream,
      'data-clarificationRequest',
      enrichedQuestion,
    );

    return enrichedQuestion;
  } catch (error) {
    console.warn('AI enrichment failed, using basic enrichment:', error);
    return createBasicEnrichedQuestion(question);
  }
}

/**
 * Generate AI-powered question enrichment
 */
async function generateAIEnrichment(
  question: ClarificationRequest,
  modelId: ChatModel['id'],
  userLevel: string,
  domain: string,
  includeExamples: boolean,
  maxExamples: number,
) {
  const enrichmentSchema = z.object({
    enrichedQuestion: z
      .string()
      .describe('Improved, clearer version of the question'),
    explanation: z
      .string()
      .describe('Clear explanation of what this question is asking for'),
    whyAsked: z
      .string()
      .describe('Why this question is being asked in the workflow'),
    howUsed: z
      .string()
      .describe('How the answer will be used in the next steps'),
    examples: includeExamples
      ? z
          .array(z.string())
          .max(maxExamples)
          .describe('Helpful examples of good answers')
      : z.array(z.string()).optional(),
    relatedConcepts: z
      .array(z.string())
      .describe('Related concepts the user should know about'),
    tips: z
      .array(z.string())
      .describe('Helpful tips for providing a good answer'),
    commonMistakes: z.array(z.string()).describe('Common mistakes to avoid'),
  });

  return await AISDKIntegration.generateStructuredAnalysis(
    modelId,
    enrichmentSchema,
    `Enrich this clarification question for a ${userLevel} user in the ${domain} domain:
     
     Original Question: "${question.question}"
     Context: "${question.context}"
     Priority: ${question.priority}
     Agent: ${question.agentName}
     
     Make the question clearer and more actionable. Provide helpful context that will guide the user to give a complete, useful answer. Consider the user's experience level and the technical domain.
     
     ${includeExamples ? `Include up to ${maxExamples} concrete examples of good answers.` : 'Do not include examples.'}`,
    `You are an expert at making technical questions clear and actionable for users of different experience levels. Your goal is to help users understand exactly what information is needed and how to provide it effectively.`,
  );
}

/**
 * Create contextual help from AI enrichment
 */
function createContextualHelp(
  enrichment: any,
  question: ClarificationRequest,
): ContextualHelp {
  return {
    explanation: enrichment.explanation,
    whyAsked: enrichment.whyAsked,
    howUsed: enrichment.howUsed,
    relatedConcepts: enrichment.relatedConcepts || [],
    documentationLinks: generateDocumentationLinks(
      question,
      enrichment.relatedConcepts || [],
    ),
  };
}

/**
 * Generate validation rules based on question content
 */
async function generateValidationRules(
  question: ClarificationRequest,
  modelId: ChatModel['id'],
): Promise<ValidationRule[]> {
  try {
    const rulesSchema = z.object({
      rules: z.array(
        z.object({
          type: z.enum(['required', 'format', 'range', 'custom']),
          rule: z.string(),
          errorMessage: z.string(),
          severity: z.enum(['error', 'warning']),
          reasoning: z.string(),
        }),
      ),
    });

    const rulesAnalysis = await AISDKIntegration.generateStructuredAnalysis(
      modelId,
      rulesSchema,
      `Generate validation rules for this question:
       Question: "${question.question}"
       Context: "${question.context}"
       
       Create appropriate validation rules that will help ensure the user provides a complete and correctly formatted answer. Consider what format constraints, length requirements, or content requirements would be appropriate.`,
      'You are an expert at creating validation rules that help users provide better answers while not being overly restrictive.',
    );

    return rulesAnalysis.rules.map((rule) => ({
      type: rule.type,
      rule: rule.rule,
      errorMessage: rule.errorMessage,
      severity: rule.severity,
    }));
  } catch (error) {
    console.warn('Failed to generate validation rules:', error);
    return getBasicValidationRules(question);
  }
}

/**
 * Find related questions using AI analysis
 */
async function findRelatedQuestions(
  question: ClarificationRequest,
  modelId: ChatModel['id'],
): Promise<string[]> {
  try {
    // This would ideally analyze the question against a knowledge base
    // For now, we'll return an empty array but the structure is ready for enhancement
    const relatedSchema = z.object({
      relatedQuestions: z.array(z.string()),
      reasoning: z.string(),
    });

    const related = await AISDKIntegration.generateStructuredAnalysis(
      modelId,
      relatedSchema,
      `Identify questions that are commonly related to this one:
       Question: "${question.question}"
       Context: "${question.context}"
       Domain: ${question.agentName}
       
       What other questions are typically asked in similar contexts? What information is usually needed alongside this question?`,
      'You are an expert at understanding question relationships and information dependencies.',
    );

    return related.relatedQuestions;
  } catch (error) {
    console.warn('Failed to find related questions:', error);
    return [];
  }
}

/**
 * Detect question dependencies based on content analysis
 */
function detectDependencies(question: ClarificationRequest): string[] {
  const dependencies: string[] = [];
  const questionLower = question.question.toLowerCase();
  const contextLower = question.context.toLowerCase();

  // Simple heuristic-based dependency detection
  // This could be enhanced with AI analysis

  if (questionLower.includes('after') || questionLower.includes('once')) {
    dependencies.push('prerequisite-step');
  }

  if (
    questionLower.includes('based on') ||
    questionLower.includes('depending on')
  ) {
    dependencies.push('conditional-input');
  }

  if (contextLower.includes('previous') || contextLower.includes('earlier')) {
    dependencies.push('previous-answer');
  }

  return dependencies;
}

/**
 * Generate follow-up actions based on question analysis
 */
async function generateFollowUpActions(
  question: ClarificationRequest,
  modelId: ChatModel['id'],
): Promise<string[]> {
  try {
    const actionsSchema = z.object({
      actions: z.array(z.string()),
      reasoning: z.string(),
    });

    const actions = await AISDKIntegration.generateStructuredAnalysis(
      modelId,
      actionsSchema,
      `What actions should be taken after this question is answered?
       Question: "${question.question}"
       Context: "${question.context}"
       Agent: ${question.agentName}
       
       Consider what the next logical steps would be once this information is provided.`,
      'You are an expert at workflow planning and understanding the sequence of actions in technical processes.',
    );

    return actions.actions;
  } catch (error) {
    console.warn('Failed to generate follow-up actions:', error);
    return [];
  }
}

/**
 * Generate documentation links based on question content
 */
function generateDocumentationLinks(
  question: ClarificationRequest,
  relatedConcepts: string[],
): string[] {
  const links: string[] = [];
  const questionLower = question.question.toLowerCase();

  // This is a placeholder for actual documentation link generation
  // In a real implementation, this would map concepts to actual documentation URLs

  if (questionLower.includes('terraform')) {
    links.push('https://terraform.io/docs');
  }

  if (questionLower.includes('aws')) {
    links.push('https://docs.aws.amazon.com');
  }

  if (questionLower.includes('docker')) {
    links.push('https://docs.docker.com');
  }

  // Add concept-based links
  relatedConcepts.forEach((concept) => {
    const conceptLower = concept.toLowerCase();
    if (conceptLower.includes('security')) {
      links.push('https://owasp.org/www-project-top-ten/');
    }
    if (conceptLower.includes('database')) {
      links.push('https://www.postgresql.org/docs/');
    }
  });

  return links;
}

/**
 * Get basic validation rules as fallback
 */
function getBasicValidationRules(
  question: ClarificationRequest,
): ValidationRule[] {
  const rules: ValidationRule[] = [];
  const questionLower = question.question.toLowerCase();

  // Always require non-empty answers
  rules.push({
    type: 'required',
    rule: 'non-empty',
    errorMessage: 'This question requires an answer',
    severity: 'error',
  });

  // Add basic format rules based on question content
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
      errorMessage: 'Please provide a valid URL',
      severity: 'warning',
    });
  }

  return rules;
}

/**
 * Create basic enriched question without AI enhancement (fallback)
 */
function createBasicEnrichedQuestion(
  question: ClarificationRequest,
): EnrichedClarificationRequest {
  const contextualHelp: ContextualHelp = {
    explanation: `This question is part of the ${question.agentName} workflow and requires your input to proceed.`,
    whyAsked:
      'This information is needed to configure the next steps in the process.',
    howUsed:
      'Your answer will be used to determine the appropriate configuration and next actions.',
    relatedConcepts: [],
    documentationLinks: [],
  };

  return {
    ...question,
    hash: '',
    dependencies: [],
    relatedQuestions: [],
    validationRules: getBasicValidationRules(question),
    contextualHelp,
    examples: question.options || [],
    followUpActions: [],
  };
}

/**
 * Enrich multiple questions in batch
 */
export async function enrichQuestionsBatch(
  questions: ClarificationRequest[],
  modelId: ChatModel['id'],
  dataStream: UIMessageStreamWriter<ChatMessage>,
  options: Parameters<typeof enrichQuestion>[3] = {},
): Promise<EnrichedClarificationRequest[]> {
  const enrichedQuestions: EnrichedClarificationRequest[] = [];

  for (const question of questions) {
    try {
      const enriched = await enrichQuestion(
        question,
        modelId,
        dataStream,
        options,
      );
      enrichedQuestions.push(enriched);
    } catch (error) {
      console.warn(`Failed to enrich question ${question.id}:`, error);
      enrichedQuestions.push(createBasicEnrichedQuestion(question));
    }
  }

  return enrichedQuestions;
}

/**
 * Analyze question complexity and suggest appropriate user level
 */
export async function analyzeQuestionComplexity(
  question: ClarificationRequest,
  modelId: ChatModel['id'],
): Promise<{
  complexity: 'low' | 'medium' | 'high';
  suggestedUserLevel: 'beginner' | 'intermediate' | 'advanced';
  reasoning: string;
  recommendedApproach: string;
}> {
  try {
    const complexitySchema = z.object({
      complexity: z.enum(['low', 'medium', 'high']),
      suggestedUserLevel: z.enum(['beginner', 'intermediate', 'advanced']),
      reasoning: z.string(),
      recommendedApproach: z.string(),
      technicalConcepts: z.array(z.string()),
    });

    const analysis = await AISDKIntegration.generateStructuredAnalysis(
      modelId,
      complexitySchema,
      `Analyze the complexity of this question:
       Question: "${question.question}"
       Context: "${question.context}"
       
       Determine how complex this question is and what level of technical expertise would be needed to answer it well.`,
      'You are an expert at assessing question complexity and matching it to appropriate user experience levels.',
    );

    return {
      complexity: analysis.complexity,
      suggestedUserLevel: analysis.suggestedUserLevel,
      reasoning: analysis.reasoning,
      recommendedApproach: analysis.recommendedApproach,
    };
  } catch (error) {
    console.warn('Failed to analyze question complexity:', error);
    return {
      complexity: 'medium',
      suggestedUserLevel: 'intermediate',
      reasoning: 'Unable to analyze complexity, using default assessment',
      recommendedApproach: 'Provide clear examples and explanations',
    };
  }
}

/**
 * Generate contextual help for existing questions
 */
export async function generateContextualHelp(
  chatId: string,
  questionId: string,
  modelId: ChatModel['id'],
  userLevel: 'beginner' | 'intermediate' | 'advanced' = 'intermediate',
): Promise<ContextualHelp | null> {
  const question = QuestionHistoryManager.getQuestion(chatId, questionId);

  if (!question) {
    return null;
  }

  try {
    const helpSchema = z.object({
      explanation: z.string(),
      whyAsked: z.string(),
      howUsed: z.string(),
      relatedConcepts: z.array(z.string()),
      tips: z.array(z.string()),
    });

    const help = await AISDKIntegration.generateStructuredAnalysis(
      modelId,
      helpSchema,
      `Generate contextual help for this question for a ${userLevel} user:
       Question: "${question.question}"
       Context: "${question.context}"
       
       Provide clear, helpful explanations that will guide the user to provide a good answer.`,
      'You are an expert at providing clear, helpful guidance to users of different technical levels.',
    );

    return {
      explanation: help.explanation,
      whyAsked: help.whyAsked,
      howUsed: help.howUsed,
      relatedConcepts: help.relatedConcepts,
      documentationLinks: generateDocumentationLinks(
        {
          question: question.question,
          context: question.context,
        } as ClarificationRequest,
        help.relatedConcepts,
      ),
    };
  } catch (error) {
    console.warn('Failed to generate contextual help:', error);
    return null;
  }
}
