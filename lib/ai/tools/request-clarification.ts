import { z } from 'zod';
import { tool, type UIMessageStreamWriter } from 'ai';
import { generateUUID } from '@/lib/utils';
import type { ChatMessage, ClarificationRequest } from '@/lib/types';
import { ConversationStateManager } from '@/lib/ai/conversation-state';
import { SmartQuestionManager } from '@/lib/ai/enhanced-conversation-state';

interface RequestClarificationProps {
  dataStream: UIMessageStreamWriter<ChatMessage>;
  agentName: string;
  chatId: string;
}

export const requestClarification = ({
  dataStream,
  agentName,
  chatId,
}: RequestClarificationProps) =>
  tool({
    description: `Request clarification from the user with AI-powered question deduplication, context enrichment, and answer reuse. This enhanced tool automatically checks for similar previous questions and provides enriched context to help users provide better answers.`,
    inputSchema: z.object({
      clarifications: z
        .array(
          z.object({
            question: z
              .string()
              .describe('The specific question you need answered to proceed'),
            context: z
              .string()
              .describe(
                'Background context explaining why this clarification is needed',
              ),
            options: z
              .array(z.string())
              .optional()
              .describe(
                'Optional predefined choices for the user to select from',
              ),
            priority: z
              .enum(['low', 'medium', 'high'])
              .default('medium')
              .describe('Priority level of this clarification'),
            allowAnswerReuse: z
              .boolean()
              .default(true)
              .describe(
                'Whether to check for and reuse previous similar answers',
              ),
            requireValidation: z
              .boolean()
              .default(true)
              .describe('Whether to validate the answer when received'),
          }),
        )
        .min(1)
        .describe('Array of enhanced clarification requests to ask the user'),
    }),
    execute: async ({ clarifications }) => {
      const clarificationIds: string[] = [];
      const responses: string[] = [];
      const reusedAnswers: string[] = [];

      // Process each clarification request with AI enhancements
      for (const {
        question,
        context,
        options,
        priority,
        allowAnswerReuse,
        requireValidation,
      } of clarifications) {
        const clarificationId = generateUUID();
        clarificationIds.push(clarificationId);

        try {
          // Create basic clarification request
          const basicRequest: ClarificationRequest = {
            id: clarificationId,
            agentName,
            question,
            context,
            options: options || undefined,
            priority,
            timestamp: new Date().toISOString(),
          };

          // Step 1: Process question with AI-powered deduplication and enrichment
          const processResult = await SmartQuestionManager.processQuestion(
            chatId,
            basicRequest,
            'gpt-4', // Use a default model ID
            dataStream,
            {
              enableDeduplication: allowAnswerReuse,
              enableEnrichment: true,
              confidenceThreshold: 0.8,
              userLevel: 'intermediate',
            },
          );

          // Step 2: Handle answer reuse if applicable
          if (!processResult.shouldAsk && processResult.reusedAnswer) {
            reusedAnswers.push(
              `Reused answer for "${question}" (${processResult.reasoning})`,
            );

            // Stream reuse notification to UI
            dataStream.write({
              type: 'data-answerReuse',
              data: {
                questionId: clarificationId,
                reusedAnswer: processResult.reusedAnswer,
                reasoning: processResult.reasoning,
                originalQuestion: question,
              },
              transient: false,
            });

            responses.push(
              `Answer reused for "${question}" - ${processResult.reasoning}`,
            );
            continue; // Skip to next question since we reused the answer
          }

          // Step 3: Use the processed (enriched) question
          const clarificationRequest = processResult.processedQuestion || {
            ...basicRequest,
            hash: '',
            dependencies: [],
            relatedQuestions: [],
            validationRules: [],
            contextualHelp: {
              explanation: `This question is part of the ${agentName} workflow.`,
              whyAsked: 'This information is needed to proceed.',
              howUsed: 'Your answer will be used in the next steps.',
              relatedConcepts: [],
              documentationLinks: [],
            },
            examples: options || [],
            followUpActions: [],
          };

          // Step 4: Update conversation state with enhanced request
          try {
            ConversationStateManager.addClarificationRequest(
              chatId,
              clarificationRequest,
            );
          } catch (e) {
            console.error(
              'Failed to add enhanced clarification request to state:',
              e,
            );
          }

          // Step 5: Send the enhanced clarification request to the UI
          dataStream.write({
            type: 'data-clarificationRequest',
            data: clarificationRequest,
            transient: false, // Keep this in the conversation history
          });

          // Step 6: Stream enrichment data to UI for better user experience
          if (clarificationRequest.contextualHelp) {
            dataStream.write({
              type: 'data-questionEnrichment',
              data: {
                questionId: clarificationId,
                enrichment: clarificationRequest.contextualHelp,
                questionHash: clarificationRequest.hash,
                examples: clarificationRequest.examples,
                validationRules: clarificationRequest.validationRules,
              },
              transient: true, // This is just for UI enhancement
            });
          }

          responses.push(`Enhanced clarification requested: "${question}"`);
        } catch (error) {
          console.error(
            `Failed to process enhanced clarification for "${question}":`,
            error,
          );

          // Fallback to basic clarification request
          const basicClarificationRequest: ClarificationRequest = {
            id: clarificationId,
            agentName,
            question,
            context,
            options: options || undefined,
            priority,
            timestamp: new Date().toISOString(),
          };

          ConversationStateManager.addClarificationRequest(
            chatId,
            basicClarificationRequest,
          );

          dataStream.write({
            type: 'data-clarificationRequest',
            data: basicClarificationRequest,
            transient: false,
          });

          responses.push(
            `Basic clarification requested: "${question}" (enhancement failed)`,
          );
        }
      }

      // Return comprehensive result
      return {
        ids: clarificationIds,
        message: `${clarifications.length} enhanced clarification(s) requested from user. ${reusedAnswers.length} answer(s) reused. Waiting for responses.`,
        status: 'pending',
        count: clarifications.length,
        reusedCount: reusedAnswers.length,
        enhancedFeatures: {
          questionDeduplication: true,
          contextEnrichment: true,
          answerReuse: reusedAnswers.length > 0,
          validationReady: clarifications.some((c) => c.requireValidation),
        },
        responses,
        reusedAnswers,
      };
    },
  });

/**
 * Enhanced clarification response handler with AI-powered validation
 */
export const processClarificationResponse = ({
  dataStream,
  agentName,
  chatId,
}: RequestClarificationProps) =>
  tool({
    description: `Process and validate clarification responses with AI-powered validation, learning, and feedback generation.`,
    inputSchema: z.object({
      requestId: z
        .string()
        .describe('ID of the clarification request being answered'),
      answer: z
        .string()
        .describe("The user's answer to the clarification question"),
      selectedOption: z
        .string()
        .optional()
        .describe('Selected option if question had predefined choices'),
      skipValidation: z
        .boolean()
        .default(false)
        .describe('Whether to skip AI validation of the answer'),
    }),
    execute: async ({ requestId, answer, selectedOption, skipValidation }) => {
      try {
        // Get the original clarification request
        const clarificationRequest =
          ConversationStateManager.getClarificationRequest(chatId, requestId);
        if (!clarificationRequest) {
          return {
            success: false,
            message: `Clarification request ${requestId} not found`,
            error: 'REQUEST_NOT_FOUND',
          };
        }

        // Create clarification response
        const clarificationResponse = {
          id: generateUUID(),
          requestId,
          answer,
          selectedOption,
          timestamp: new Date().toISOString(),
          agentName,
        };

        let validationResult: any = undefined;
        let isValid = true;
        let feedback: string[] = [];

        // Step 1: Validate the answer if validation is enabled
        if (!skipValidation) {
          validationResult = await SmartQuestionManager.validateAnswer(
            chatId,
            requestId,
            clarificationResponse,
            'gpt-4', // Use a default model ID
            dataStream,
          );

          isValid = validationResult.isValid;
          feedback = validationResult.suggestions || [];

          // Stream validation result to UI
          dataStream.write({
            type: 'data-validationResult',
            data: {
              requestId,
              validationResult,
              isValid,
              feedback,
            },
            transient: false,
          });
        }

        // Step 2: Store the answer in question history for future reuse
        // This is now handled automatically by the SmartQuestionManager.validateAnswer function

        // Step 3: Update conversation state
        try {
          ConversationStateManager.addClarificationResponse(
            chatId,
            clarificationResponse,
          );

          if (isValid) {
            ConversationStateManager.markClarificationResolved(
              chatId,
              requestId,
            );
          }
        } catch (e) {
          console.error('Failed to add clarification response to state:', e);
        }

        // Step 4: Send response to UI
        dataStream.write({
          type: 'data-clarificationResponse',
          data: {
            ...clarificationResponse,
            validationResult,
            isValid,
            feedback,
          },
          transient: false,
        });

        // Step 5: Generate AI-powered follow-up questions if answer needs improvement
        if (!isValid && feedback.length > 0) {
          // Generate intelligent follow-up questions to help user provide better answer
          const followUpQuestions =
            await SmartQuestionManager.generateFollowUpQuestions(
              chatId,
              requestId,
              'gpt-4', // Use a default model ID
            );

          dataStream.write({
            type: 'data-clarificationFeedback',
            data: {
              requestId,
              feedback,
              suggestions: validationResult?.suggestions || [],
              followUpQuestions,
              canRetry: true,
              improvementGuidance: validationResult?.improvementGuidance,
            },
            transient: true,
          });

          return {
            success: false,
            message: `Answer validation failed. Please review the feedback and follow-up questions to provide a better answer.`,
            validationResult,
            feedback,
            followUpQuestions,
            canRetry: true,
          };
        }

        // Step 6: Generate learning insights for successful answers
        if (isValid && validationResult) {
          try {
            // Stream learning insights to help improve future questions
            dataStream.write({
              type: 'data-learningInsights',
              data: {
                requestId,
                questionHash: clarificationRequest.questionHash,
                insights: validationResult.learningInsights || [],
                qualityScore: validationResult.qualityScore,
                improvementSuggestions:
                  validationResult.improvementSuggestions || [],
              },
              transient: true,
            });
          } catch (error) {
            console.error('Failed to generate learning insights:', error);
          }
        }

        return {
          success: true,
          message: `Clarification response processed successfully${validationResult ? ' and validated' : ''}`,
          responseId: clarificationResponse.id,
          isValid,
          validationResult,
          feedback,
        };
      } catch (error) {
        console.error('Failed to process clarification response:', error);

        return {
          success: false,
          message: `Failed to process clarification response: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error: 'PROCESSING_FAILED',
        };
      }
    },
  });
