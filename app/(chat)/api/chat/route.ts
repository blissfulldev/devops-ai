import { createUIMessageStream, JsonToSseTransformStream } from 'ai';
import { auth, type UserType } from '@/app/(auth)/auth';
import type { RequestHints } from '@/lib/ai/prompts';
import type { Session } from 'next-auth';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { runSupervisorAgent } from '@/lib/ai/agents/supervisor';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { geolocation } from '@vercel/functions';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL',
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel['id'];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const userType: UserType = session.user.type;

    // const messageCount = await getMessageCountByUserId({
    //   id: session.user.id,
    //   differenceInHours: 24,
    // });

    // if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
    //   return new ChatSDKError('rate_limit:chat').toResponse();
    // }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType,
      });
    } else {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError('forbidden:chat').toResponse();
      }
    }

    const messagesFromDb = await getMessagesByChatId({ id });
    
    // Validate message structure before processing
    if (!message.parts || !Array.isArray(message.parts)) {
      console.error('Invalid message structure - missing or invalid parts:', message);
      return new ChatSDKError('bad_request:api').toResponse();
    }

    // Validate each part has the required structure
    for (const part of message.parts) {
      if (!part || typeof part !== 'object' || !part.type) {
        console.error('Invalid message part structure:', part);
        return new ChatSDKError('bad_request:api').toResponse();
      }
      
      if (part.type === 'text') {
        if (
          !('text' in part) ||
          typeof part.text !== 'string' ||
          part.text.trim().length === 0
        ) {
          console.error(
            'Invalid text part - missing, invalid, or empty text property:',
            part,
          );
          return new ChatSDKError('bad_request:api').toResponse();
        }
      }
    }

    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: 'user',
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        try {
          const result = runSupervisorAgent({
            selectedChatModel,
            uiMessages,
            session: session as Session,
            dataStream,
            telemetryId: 'supervisor-stream-text',
            chatId: id,
          });

          result.consumeStream();
          dataStream.merge(result.toUIMessageStream({ sendReasoning: true }));
        } catch (error: any) {
          console.error('Error in supervisor agent execution:', error);

          // Handle specific Gemini API errors
          let errorMessage =
            'An error occurred while processing your request. Please try again.';
          if (
            error?.message?.includes('function_call.args') ||
            error?.message?.includes('Invalid value')
          ) {
            errorMessage =
              'The content is too large for processing. Please try with a shorter request or break it into smaller parts.';
          } else if (error?.message?.includes('INVALID_ARGUMENT')) {
            errorMessage =
              'Invalid request format. Please rephrase your request and try again.';
          }

          dataStream.write({
            type: 'text-delta',
            delta: errorMessage,
            id: 'error-message',
          });
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        try {
          await saveMessages({
            messages: messages.map((message) => ({
              id: message.id,
              role: message.role,
              parts: message.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        } catch (error) {
          console.error('Error saving messages:', error);
        }
      },
      onError: (error) => {
        console.error('Stream error:', error);
        return 'Oops, an error occurred!';
      },
    });

    const streamContext = getStreamContext();

    if (streamContext) {
      return new Response(
        await streamContext.resumableStream(streamId, () =>
          stream.pipeThrough(new JsonToSseTransformStream()),
        ),
      );
    } else {
      return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
    }
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const chat = await getChatById({ id });

  if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
