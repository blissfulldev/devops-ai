import { z } from 'zod';
import { generateObject, tool, type UIMessageStreamWriter } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { WorkflowGuidance, EnrichedClarificationRequest } from './types';

/**
 * Generate structured AI analysis using generateObject
 */
export async function generateStructuredAnalysis<T>(
  modelId: ChatModel['id'],
  schema: z.ZodSchema<T>,
  prompt: string,
  systemPrompt?: string,
): Promise<T> {
  const params: any = {
    model: myProvider.languageModel(modelId),
    schema,
    prompt,
  };

  if (systemPrompt) {
    params.system = systemPrompt;
  }

  const { object } = await generateObject(params);
  return object as T;
}

/**
 * Stream data to UI using AI SDK V5 data streaming
 */
export function streamToUI(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  type:
    | 'data-appendMessage'
    | 'data-clarificationRequest'
    | 'data-clarificationResponse',
  data: any,
): void {
  dataStream.write({
    type,
    data,
  });
}

/**
 * Zod schemas for AI-powered operations
 */
export const AISchemas = {
  // Answer validation schema
  answerValidation: z.object({
    isValid: z.boolean(),
    confidence: z.number().min(0).max(1),
    issues: z.array(
      z.object({
        type: z.enum([
          'incomplete',
          'invalid_format',
          'out_of_range',
          'ambiguous',
        ]),
        message: z.string(),
        severity: z.enum(['error', 'warning', 'info']),
        suggestedFix: z.string().optional(),
      }),
    ),
    suggestions: z.array(z.string()),
    requiresFollowUp: z.boolean(),
  }),

  // Question similarity analysis schema
  questionSimilarity: z.object({
    similarity: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    canReuse: z.boolean(),
    suggestedModifications: z.array(z.string()).optional(),
  }),

  // Question enrichment schema
  questionEnrichment: z.object({
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
  }),

  // Workflow guidance schema
  workflowGuidance: z.object({
    guidance: z.string(),
    nextSteps: z.array(z.string()),
    estimatedTime: z.number(),
    confidence: z.number().min(0).max(1),
    alternatives: z.array(z.string()).optional(),
  }),
};

/**
 * Create answer validation tool
 */
export function createAnswerValidationTool(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
) {
  return tool({
    description: 'Validate a user answer using AI-powered analysis',
    inputSchema: z.object({
      questionId: z.string(),
      answer: z.string(),
      strictMode: z.boolean().default(false),
    }),
    execute: async ({ questionId, answer, strictMode }) => {
      try {
        // This would integrate with the answer validator
        const validation = await generateStructuredAnalysis(
          modelId,
          AISchemas.answerValidation,
          `Validate this answer:
           Question ID: ${questionId}
           Answer: "${answer}"
           Strict Mode: ${strictMode}
           
           Evaluate completeness, accuracy, and usefulness.`,
          'You are an expert at validating user responses.',
        );

        streamToUI(
          dataStream,
          'data-appendMessage',
          JSON.stringify(validation),
        );
        return validation;
      } catch (error) {
        console.error('Answer validation failed:', error);
        return {
          isValid: false,
          confidence: 0,
          issues: [
            {
              type: 'incomplete',
              message: 'Validation failed',
              severity: 'error',
            },
          ],
          suggestions: ['Please try again'],
          requiresFollowUp: false,
        };
      }
    },
  });
}

/**
 * Create question processing tool
 */
export function createQuestionProcessingTool(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
) {
  return tool({
    description: 'Process and enrich a clarification question',
    inputSchema: z.object({
      question: z.string(),
      context: z.string(),
      priority: z.enum(['low', 'medium', 'high']),
      agentName: z.string(),
    }),
    execute: async ({ question, context, priority, agentName }) => {
      try {
        const enrichment = await generateStructuredAnalysis(
          modelId,
          AISchemas.questionEnrichment,
          `Enrich this clarification question:
           Question: "${question}"
           Context: "${context}"
           Priority: ${priority}
           Agent: ${agentName}
           
           Make it clearer and provide helpful context.`,
          'You are an expert at making technical questions clear and actionable.',
        );

        const enrichedQuestion: EnrichedClarificationRequest = {
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          question: enrichment.enrichedQuestion,
          context,
          priority,
          agentName,
          timestamp: new Date().toISOString(),
          options: [],
          hash: '',
          dependencies: [],
          relatedQuestions: [],
          validationRules: enrichment.validationRules,
          contextualHelp: {
            explanation: enrichment.explanation,
            whyAsked: enrichment.whyAsked,
            howUsed: enrichment.howUsed,
            relatedConcepts: enrichment.relatedConcepts,
            documentationLinks: [],
          },
          examples: enrichment.examples,
          followUpActions: [],
        };

        streamToUI(dataStream, 'data-clarificationRequest', enrichedQuestion);
        return enrichedQuestion;
      } catch (error) {
        console.error('Question processing failed:', error);
        return {
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          question,
          context,
          priority,
          agentName,
          options: [],
        };
      }
    },
  });
}

/**
 * Create follow-up generation tool
 */
export function createFollowUpGenerationTool(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
) {
  return tool({
    description: 'Generate follow-up questions based on an answer',
    inputSchema: z.object({
      originalQuestion: z.string(),
      answer: z.string(),
      context: z.string(),
    }),
    execute: async ({ originalQuestion, answer, context }) => {
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

        const followUp = await generateStructuredAnalysis(
          modelId,
          followUpSchema,
          `Generate follow-up questions based on:
           Original Question: "${originalQuestion}"
           Answer: "${answer}"
           Context: "${context}"
           
           What additional information might be needed?`,
          'You are an expert at identifying information gaps.',
        );

        streamToUI(
          dataStream,
          'data-appendMessage',
          JSON.stringify(followUp.followUpQuestions),
        );
        return followUp.followUpQuestions;
      } catch (error) {
        console.error('Follow-up generation failed:', error);
        return [];
      }
    },
  });
}

/**
 * Create workflow guidance tool
 */
export function createWorkflowGuidanceTool(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  modelId: ChatModel['id'],
) {
  return tool({
    description: 'Generate workflow guidance for the current state',
    inputSchema: z.object({
      currentStep: z.string(),
      completedSteps: z.array(z.string()),
      userLevel: z
        .enum(['beginner', 'intermediate', 'advanced'])
        .default('intermediate'),
    }),
    execute: async ({ currentStep, completedSteps, userLevel }) => {
      try {
        const guidance = await generateStructuredAnalysis(
          modelId,
          AISchemas.workflowGuidance,
          `Generate workflow guidance:
           Current Step: "${currentStep}"
           Completed Steps: ${completedSteps.join(', ')}
           User Level: ${userLevel}
           
           Provide clear guidance for what to do next.`,
          'You are an expert workflow guide.',
        );

        streamToUI(dataStream, 'data-appendMessage', JSON.stringify(guidance));
        return guidance;
      } catch (error) {
        console.error('Workflow guidance generation failed:', error);
        return {
          guidance: 'Continue with the current step',
          nextSteps: ['Complete the current task'],
          estimatedTime: 300,
          confidence: 0.5,
        };
      }
    },
  });
}

/**
 * Stream workflow guidance updates
 */
export function streamWorkflowGuidance(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  guidance: WorkflowGuidance,
): void {
  streamToUI(dataStream, 'data-appendMessage', JSON.stringify(guidance));
}

/**
 * Stream progress updates
 */
export function streamProgressUpdate(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  progress: {
    overallProgress: number;
    currentStep: string;
    estimatedTimeRemaining: number;
  },
): void {
  streamToUI(dataStream, 'data-appendMessage', JSON.stringify(progress));
}

// Legacy compatibility - keeping the old class structure as namespace
export const AISDKIntegration = {
  generateStructuredAnalysis,
  streamToUI,
};

export const AIToolFactory = {
  createAnswerValidationTool,
  createQuestionProcessingTool,
  createFollowUpGenerationTool,
  createWorkflowGuidanceTool,
};

export const StreamingUtils = {
  streamWorkflowGuidance,
  streamProgressUpdate,
};
