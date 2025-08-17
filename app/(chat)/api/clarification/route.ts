import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { ConversationStateManager } from '@/lib/ai/conversation-state';
import { z } from 'zod';

const clarificationResponseSchema = z.object({
  chatId: z.string(),
  response: z.object({
    id: z.string(),
    requestId: z.string(),
    answer: z.string(),
    selectedOption: z.string().optional(),
    timestamp: z.string(),
  }),
});

const batchClarificationResponseSchema = z.object({
  chatId: z.string(),
  responses: z.array(
    z.object({
      id: z.string(),
      requestId: z.string(),
      answer: z.string(),
      selectedOption: z.string().optional(),
      timestamp: z.string(),
    }),
  ),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    
    // Try to parse as batch response first, then fallback to single response
    let responses: Array<{
      id: string;
      requestId: string;
      answer: string;
      selectedOption?: string;
      timestamp: string;
    }>;
    let chatId: string;

    const batchParseResult = batchClarificationResponseSchema.safeParse(body);
    if (batchParseResult.success) {
      // Handle batch responses
      chatId = batchParseResult.data.chatId;
      responses = batchParseResult.data.responses;
    } else {
      // Fallback to single response for backward compatibility
      const singleParseResult = clarificationResponseSchema.safeParse(body);
      if (!singleParseResult.success) {
        console.error(
          'Invalid clarification response schema:',
          singleParseResult.error,
        );
        return NextResponse.json(
          { error: 'Invalid request format' },
          { status: 400 },
        );
      }
      chatId = singleParseResult.data.chatId;
      responses = [singleParseResult.data.response];
    }

    // Validate all responses
    for (const response of responses) {
      if (!response.answer || response.answer.trim().length === 0) {
        return NextResponse.json(
          { error: 'Answer cannot be empty' },
          { status: 400 },
        );
      }
    }

    // Store all clarification responses
    responses.forEach((response) => {
      ConversationStateManager.addClarificationResponse(chatId, response);
    });

    // Check if we can resume the workflow
    const isStillWaiting = ConversationStateManager.isWaitingForClarification(chatId);
    
    return NextResponse.json({
      success: true,
      canResume: !isStillWaiting,
      responsesProcessed: responses.length,
      message: isStillWaiting
        ? `${responses.length} response(s) recorded. Still waiting for other clarifications.`
        : `All ${responses.length} clarification(s) received. Workflow can resume.`,
    });
  } catch (error) {
    console.error('Error handling clarification response:', error);
    
    // Provide more specific error messages
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to process clarification response' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chatId');

    if (!chatId) {
      return NextResponse.json({ error: 'Chat ID required' }, { status: 400 });
    }

    const pendingClarifications = ConversationStateManager.getPendingClarifications(chatId);
    console.log('Pending clarifications:', pendingClarifications);
    const isWaiting = ConversationStateManager.isWaitingForClarification(chatId);

    return NextResponse.json({
      isWaiting,
      pendingClarifications,
      count: pendingClarifications.length,
    });
  } catch (error) {
    console.error('Error fetching clarification status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch clarification status' },
      { status: 500 }
    );
  }
}