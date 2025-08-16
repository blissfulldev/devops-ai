import type { UIMessageStreamWriter } from 'ai';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { Session } from 'next-auth';

export type AgentRunner = (params: {
  selectedChatModel: ChatModel['id'];
  uiMessages: ChatMessage[];
  input: string;
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  telemetryId?: string;
  chatId?: string;
}) => any;
