import type {
  ChatMessage,
  ClarificationResponse,
  CustomUIDataTypes,
  ChatTools,
} from '@/lib/types';
import {
  streamText,
  stepCountIs,
  smoothStream,
  type UIMessageStreamWriter,
  type UIMessagePart,
} from 'ai';
import { myProvider } from '@/lib/ai/providers';
import { isProductionEnvironment } from '@/lib/constants';
import { ConversationStateManager } from '../conversation-state';

// Helper: stringify unknown errors safely
export function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message ?? String(err);
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function getClarificationAnswer(
  resp: ClarificationResponse | any,
): string {
  if (!resp) return '[No answer provided]';
  return (
    resp.answer ??
    resp.response ??
    resp.text ??
    resp.value ??
    resp.answerText ??
    '[No answer provided]'
  );
}

export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function notifyUI({
  text,
  selectedChatModel,
  dataStream,
  telemetryId,
}: {
  text: string;
  selectedChatModel: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  telemetryId: string;
}) {
  try {
    const notifier = streamText({
      model: myProvider.languageModel(selectedChatModel),
      system:
        'SYSTEM NOTE: You are a notifier. Reply with exactly the content given in the user message as a single assistant message and do NOT call any tools or add commentary.',
      messages: [{ role: 'user', content: text }],
      stopWhen: stepCountIs(1),
      experimental_transform: smoothStream({ chunking: 'word' }),
      experimental_telemetry: {
        isEnabled: isProductionEnvironment,
        functionId: `${telemetryId}-notifier`,
      },
    });

    try {
      dataStream.merge(notifier.toUIMessageStream({ sendReasoning: false }));
    } catch (err) {
      console.error(
        'Error merging notifier stream into dataStream:',
        stringifyError(err),
      );
    }

    // We don't want to block, so we consume it without await
    notifier.consumeStream().catch((err) => {
      console.error('Notifier stream error:', stringifyError(err));
    });
  } catch (err) {
    console.error(
      'Failed to push UI notice via notifier stream:',
      stringifyError(err),
    );
  }
}

export function buildAugmentedUIMessages({
  chatId,
  uiMessages,
}: {
  chatId: string;
  uiMessages: ChatMessage[];
}): ChatMessage[] {
  const rawClarResponses =
    ConversationStateManager.getAllClarificationResponses(chatId) || [];
  const clarificationResponses = rawClarResponses.filter(
    Boolean,
  ) as ClarificationResponse[];

  const clarificationMessages = clarificationResponses
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const answerText = getClarificationAnswer(r);
      return {
        id: r.id ?? `clar-${Math.random().toString(36).slice(2)}`,
        role: 'user' as const,
        parts: [
          {
            type: 'text',
            text: `Clarification response: ${answerText}`,
          } as UIMessagePart<CustomUIDataTypes, ChatTools>,
        ],
        metadata: {
          createdAt: (r.timestamp as string) ?? new Date().toISOString(),
        },
      } as ChatMessage;
    })
    .filter(Boolean) as ChatMessage[];

  return [...uiMessages, ...clarificationMessages];
}
