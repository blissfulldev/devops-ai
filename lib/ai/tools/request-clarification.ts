import { z } from 'zod';
import type { Session } from 'next-auth';
import { tool, type UIMessageStreamWriter } from 'ai';
import { generateUUID } from '@/lib/utils';
import type { ChatMessage, ClarificationRequest } from '@/lib/types';

interface RequestClarificationProps {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  agentName: string;
}

export const requestClarification = ({
  session,
  dataStream,
  agentName,
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
        options,
        priority,
        timestamp: new Date().toISOString(),
      };

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
