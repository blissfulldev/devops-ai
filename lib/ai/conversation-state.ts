import type { ClarificationRequest, ClarificationResponse } from '@/lib/types';

export interface ConversationState {
  chatId: string;
  isWaitingForClarification: boolean;
  pendingClarifications: Map<string, ClarificationRequest>;
  clarificationHistory: Map<string, ClarificationResponse>;
  clarificationQueue: ClarificationRequest[];
  currentAgent?: string;
  workflowStep?: string;
}

// In-memory store for conversation states (in production, use Redis or database)
const conversationStates = new Map<string, ConversationState>();

function getState(chatId: string): ConversationState {
  if (!conversationStates.has(chatId)) {
    conversationStates.set(chatId, {
      chatId,
      isWaitingForClarification: false,
      pendingClarifications: new Map(),
      clarificationHistory: new Map(),
      clarificationQueue: [],
    });
  }
  const state = conversationStates.get(chatId);
  if (!state) {
    throw new Error(`Failed to get conversation state for chat ${chatId}`);
  }
  return state;
}

export function addClarificationRequest(
  chatId: string,
  request: ClarificationRequest,
): void {
  const state = getState(chatId);
  
  if (!state.isWaitingForClarification) {
    // If not waiting, make this the active clarification
    state.pendingClarifications.set(request.id, request);
    state.isWaitingForClarification = true;
  } else {
    // If already waiting, add to queue for later
    state.clarificationQueue.push(request);
  }
  
  conversationStates.set(chatId, state);
}

export function addClarificationResponse(
  chatId: string,
  response: ClarificationResponse,
): void {
  const state = getState(chatId);

  state.clarificationHistory.set(response.requestId, response);
  state.pendingClarifications.delete(response.requestId);
  console.log(
    'Pending Clarifications:',
    Array.from(state.pendingClarifications.values()),
  );
  console.log(
    `Adding clarification response for request ${response.requestId} in chat with response ${response.answer}`,
  );
  if (state.pendingClarifications.size === 0) {
    // If no more pending clarifications, check queue
    // Process next clarification from queue
    const nextRequest = state.clarificationQueue.shift();
    if (nextRequest) {
      state.pendingClarifications.set(nextRequest.id, nextRequest);
      state.isWaitingForClarification = true;
    } else {
      // No more clarifications, resume workflow
      state.isWaitingForClarification = false;
      // Clear current agent to allow fresh start
      state.currentAgent = undefined;
      state.workflowStep = undefined;
    }
  }
  conversationStates.set(chatId, state);
}

export function isWaitingForClarification(chatId: string): boolean {
  return getState(chatId).isWaitingForClarification;
}

export function getPendingClarifications(chatId: string): ClarificationRequest[] {
  return Array.from(getState(chatId).pendingClarifications.values());
}

export function getClarificationResponse(
  chatId: string,
  requestId: string,
): ClarificationResponse | undefined {
  return getState(chatId).clarificationHistory.get(requestId);
}

export function setCurrentAgent(
  chatId: string,
  agentName: string,
  step?: string,
): void {
  const state = getState(chatId);
  state.currentAgent = agentName;
  state.workflowStep = step;
  conversationStates.set(chatId, state);
}

export function clearState(chatId: string): void {
  conversationStates.delete(chatId);
}

// Export as ConversationStateManager for backward compatibility
export const ConversationStateManager = {
  getState,
  addClarificationRequest,
  addClarificationResponse,
  isWaitingForClarification,
  getPendingClarifications,
  getClarificationResponse,
  setCurrentAgent,
  clearState,
};
