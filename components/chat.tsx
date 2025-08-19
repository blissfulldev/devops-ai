'use client';

import { DefaultChatTransport } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ChatHeader } from '@/components/chat-header';
import type { Vote } from '@/lib/db/schema';
import { fetcher, fetchWithErrorHandlers, generateUUID } from '@/lib/utils';
import { Artifact } from './artifact';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type { VisibilityType } from './visibility-selector';
import { useArtifactSelector } from '@/hooks/use-artifact';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey } from './sidebar-history';
import { toast } from './toast';
import type { Session } from 'next-auth';
import { useSearchParams } from 'next/navigation';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { useAutoResume } from '@/hooks/use-auto-resume';
import { ChatSDKError } from '@/lib/errors';
import type { Attachment, ChatMessage, ClarificationResponse } from '@/lib/types';
import { useDataStream } from './data-stream-provider';
import { ClarificationManager } from './clarification-manager';

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  session,
  autoResume,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: Session;
  autoResume: boolean;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();

  const [input, setInput] = useState<string>('');

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages.at(-1),
            selectedChatModel: initialChatModel,
            selectedVisibilityType: visibilityType,
            ...body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({
          type: 'error',
          description: error.message,
        });
      }
    },
  });

  const searchParams = useSearchParams();
  const query = searchParams.get('query');

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: 'user' as const,
        parts: [{ type: 'text', text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, '', `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  const { data: votes } = useSWR<Array<Vote>>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher,
  );

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const handleClarificationResponse = async (response: ClarificationResponse) => {
    try {
      console.log('Handling clarification response:', response);
      
      // Validate response before sending
      if (!response || !response.answer || !response.requestId) {
        throw new Error('Invalid clarification response');
      }

      const res = await fetch('/api/clarification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatId: id,
          response,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to submit clarification response');
      }

      const result = await res.json();
      
      if (result.canResume) {
        // Add the user's response as a message and continue the conversation
        const userMessage: ChatMessage = {
          id: response.id,
          role: 'user',
          parts: [{ type: 'text', text: `Clarification response: ${response.answer}` }],
          metadata: {
            createdAt: response.timestamp,
          },
        };

        setMessages(prev => [...prev, userMessage]);
        
        // Resume the conversation by sending a continuation message
        sendMessage({
          role: 'user' as const,
          parts: [{ 
            type: 'text', 
            text: `I have provided the clarification. Please continue with the next step in the workflow.` 
          }],
        });
      }
    } catch (error) {
      console.error('Error submitting clarification response:', error);
      toast({
        type: 'error',
        description: error instanceof Error ? error.message : 'Failed to submit clarification response',
      });
    }
  };

  // New function to handle batch clarification responses
  const handleBatchClarificationResponse = async (
    responses: ClarificationResponse[],
  ) => {
    try {
      console.log('Handling batch clarification responses:', responses);

      // Validate all responses before sending
      for (const response of responses) {
        if (!response || !response.answer || !response.requestId) {
          throw new Error('Invalid clarification response in batch');
        }
      }

      const res = await fetch('/api/clarification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatId: id,
          responses,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.error || 'Failed to submit clarification responses',
        );
      }

      const result = await res.json();

      if (result.canResume) {
        // Add all user responses as messages
        const userMessages: ChatMessage[] = responses.map((response) => ({
          id: response.id,
          role: 'user',
          parts: [
            {
              type: 'text',
              text: `Clarification response: ${response.answer}`,
            },
          ],
          metadata: {
            createdAt: response.timestamp,
          },
        }));

        setMessages((prev) => [...prev, ...userMessages]);

        // Resume the conversation by sending a continuation message
        sendMessage({
          role: 'user' as const,
          parts: [
            {
              type: 'text',
              text: `I have provided ${responses.length} clarification response(s). Please continue with the next step in the workflow.`,
            },
          ],
        });
      }
    } catch (error) {
      console.error('Error submitting batch clarification responses:', error);
      toast({
        type: 'error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to submit clarification responses',
      });
    }
  };

  return (
    <>
      <div className="flex flex-col min-w-0 h-dvh bg-background">
        <ChatHeader
          chatId={id}
          selectedModelId={initialChatModel}
          selectedVisibilityType={initialVisibilityType}
          isReadonly={isReadonly}
          session={session}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Messages
                chatId={id}
                status={status}
                votes={votes}
                messages={messages}
                setMessages={setMessages}
                regenerate={regenerate}
                isReadonly={isReadonly}
                isArtifactVisible={isArtifactVisible}
              />

              {!isReadonly && (
                <div className="px-4 pb-4">
                  <ClarificationManager
                    chatId={id}
                    onClarificationResponse={handleClarificationResponse}
                    onBatchClarificationResponse={
                      handleBatchClarificationResponse
                    }
                  />
                </div>
              )}
            </div>

            <div className="flex-shrink-0 border-t bg-background">
              <form className="flex mx-auto px-4 py-4 gap-2 w-full md:max-w-3xl">
                {!isReadonly && (
                  <MultimodalInput
                    chatId={id}
                    input={input}
                    setInput={setInput}
                    status={status}
                    stop={stop}
                    attachments={attachments}
                    setAttachments={setAttachments}
                    messages={messages}
                    setMessages={setMessages}
                    sendMessage={sendMessage}
                    selectedVisibilityType={visibilityType}
                  />
                )}
              </form>
            </div>
          </div>
        </div>
      </div>

      <Artifact
        chatId={id}
        input={input}
        setInput={setInput}
        status={status}
        stop={stop}
        attachments={attachments}
        setAttachments={setAttachments}
        sendMessage={sendMessage}
        messages={messages}
        setMessages={setMessages}
        regenerate={regenerate}
        votes={votes}
        isReadonly={isReadonly}
        selectedVisibilityType={visibilityType}
      />
    </>
  );
}
