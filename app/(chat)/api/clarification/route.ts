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

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    
    // Validate the request body
    const parseResult = clarificationResponseSchema.safeParse(body);
    if (!parseResult.success) {
      console.error('Invalid clarification response schema:', parseResult.error);
      return NextResponse.json(
        { error: 'Invalid request format' },
        { status: 400 }
      );
    }

    const { chatId, response } = parseResult.data;

    // Additional validation
    if (!response.answer || response.answer.trim().length === 0) {
      return NextResponse.json(
        { error: 'Answer cannot be empty' },
        { status: 400 }
      );
    }

    // Store the clarification response
    ConversationStateManager.addClarificationResponse(chatId, response);

    // Check if we can resume the workflow
    const isStillWaiting = ConversationStateManager.isWaitingForClarification(chatId);
    
    return NextResponse.json({
      success: true,
      canResume: !isStillWaiting,
      message: isStillWaiting 
        ? 'Response recorded. Still waiting for other clarifications.'
        : 'All clarifications received. Workflow can resume.',
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