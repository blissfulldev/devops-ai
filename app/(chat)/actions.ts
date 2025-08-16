'use server';

import { generateText, type UIMessage } from 'ai';
import { cookies } from 'next/headers';
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisiblityById,
} from '@/lib/db/queries';
import type { VisibilityType } from '@/components/visibility-selector';
import { myProvider } from '@/lib/ai/providers';

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set('chat-model', model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  try {
    // Validate message structure
    if (!message || !message.parts || !Array.isArray(message.parts)) {
      console.error('Invalid message structure in generateTitleFromUserMessage:', message);
      return 'New Chat';
    }

    // Extract text from message parts safely
    const textParts = message.parts
      .filter((part) => part && part.type === 'text')
      .map((part) => {
        if ('text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter(Boolean);

    if (textParts.length === 0) {
      console.warn('No text parts found in message for title generation');
      return 'New Chat';
    }

    const messageText = textParts.join(' ');

    const result = await generateText({
      model: myProvider.languageModel('title-model'),
      system: `\n
      - you will generate a short title based on the first message a user begins a conversation with
      - ensure it is not more than 80 characters long
      - the title should be a summary of the user's message
      - do not use quotes or colons`,
      prompt: messageText,
    });

    // Ensure we have a valid text response
    if (!result || typeof result.text !== 'string') {
      console.error('Invalid response from generateText:', result);
      return 'New Chat';
    }

    return result.text;
  } catch (error) {
    console.error('Error generating title from user message:', error);
    return 'New Chat';
  }
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisiblityById({ chatId, visibility });
}
