import { z } from 'zod';
import { tool, type UIMessageStreamWriter } from 'ai';
import { generateUUID } from '@/lib/utils';
import type { ChatMessage, ClarificationRequest } from '@/lib/types';
import { ConversationStateManager } from '@/lib/ai/conversation-state';

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
    description: `Request clarification from the user when requirements are unclear, ambiguous, or when there are multiple valid approaches. Use this tool when you need human input to proceed effectively.`,
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
          }),
        )
        .min(1)
        .describe('Array of clarification requests to ask the user'),
    }),
    execute: async ({ clarifications }) => {
      const clarificationIds: string[] = [];
      const responses: string[] = [];

      // Process each clarification request
      for (const { question, context, options, priority } of clarifications) {
        const clarificationId = generateUUID();
        clarificationIds.push(clarificationId);

        const clarificationRequest: ClarificationRequest = {
          id: clarificationId,
          agentName,
          question,
          context,
          options: options || undefined,
          priority,
          timestamp: new Date().toISOString(),
        };

        // Update conversation state to reflect waiting-for-clarification
        try {
          ConversationStateManager.addClarificationRequest(
            chatId,
            clarificationRequest,
          );
        } catch (e) {
          console.error('Failed to add clarification request to state:', e);
        }

        // Send the clarification request to the UI
        dataStream.write({
          type: 'data-clarificationRequest',
          data: clarificationRequest,
          transient: false, // Keep this in the conversation history
        });

        responses.push(`Clarification requested: "${question}"`);
      }

      // Return a message indicating we're waiting for user input
      return {
        ids: clarificationIds,
        message: `${clarifications.length} clarification(s) requested from user. Waiting for responses.`,
        status: 'pending',
        count: clarifications.length,
      };
    },
  });
