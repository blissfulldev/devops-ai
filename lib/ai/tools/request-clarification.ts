import { z } from 'zod';
import type { Session } from 'next-auth';
import { tool, type UIMessageStreamWriter } from 'ai';
import { generateUUID } from '@/lib/utils';
import type { ChatMessage, ClarificationRequest } from '@/lib/types';
import { ConversationStateManager } from '@/lib/ai/conversation-state';

interface RequestClarificationProps {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  agentName: string;
  chatId: string;
}

export const requestClarification = ({
  session,
  dataStream,
  agentName,
  chatId,
}: RequestClarificationProps) =>
  tool({
    description: `Request clarification from the user when requirements are unclear, ambiguous, or when there are multiple valid approaches. Use this tool when you need human input to proceed effectively.`,
    inputSchema: z.object({
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
        .describe('Optional predefined choices for the user to select from'),
      priority: z
        .enum(['low', 'medium', 'high'])
        .default('medium')
        .describe('Priority level of this clarification'),
    }),
    execute: async ({ question, context, options, priority }) => {
      const clarificationId = generateUUID();

      const clarificationRequest: ClarificationRequest = {
        id: clarificationId,
        agentName,
        question,
        context,
        options: options || undefined, // Ensure null becomes undefined
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

      // Return a message indicating we're waiting for user input
      return {
        id: clarificationId,
        message: `Clarification requested from user. Waiting for response to: "${question}"`,
        status: 'pending',
      };
    },
  });
