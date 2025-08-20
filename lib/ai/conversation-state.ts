import type { ClarificationRequest, ClarificationResponse } from '@/lib/types';

export enum AgentStatus {
  NOT_STARTED = 'not_started',
  RUNNING = 'running',
  WAITING_FOR_CLARIFICATION = 'waiting_for_clarification',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum WorkflowPhase {
  PLANNING = 'planning',
  DESIGN = 'design',
  IMPLEMENTATION = 'implementation',
  COMPLETED = 'completed',
}

export interface AgentWorkflowState {
  core_agent: AgentStatus;
  diagram_agent: AgentStatus;
  terraform_agent: AgentStatus;
}

export interface ConversationState {
  chatId: string;
  workflowPhase: WorkflowPhase;
  currentAgent?: string;
  pausedAgent?: string; // resume pointer: which agent asked for clarification
  agentStates: AgentWorkflowState;
  isWaitingForClarification: boolean;
  pendingClarifications: Map<string, ClarificationRequest>;
  clarificationHistory: Map<string, ClarificationResponse>;
  clarificationQueue: ClarificationRequest[];
  workflowStep?: string;
}

// In-memory store for conversation states (production: swap for Redis/DB)
const conversationStates = new Map<string, ConversationState>();

export function getState(chatId: string): ConversationState {
  if (!conversationStates.has(chatId)) {
    conversationStates.set(chatId, {
      chatId,
      workflowPhase: WorkflowPhase.PLANNING,
      agentStates: {
        core_agent: AgentStatus.NOT_STARTED,
        diagram_agent: AgentStatus.NOT_STARTED,
        terraform_agent: AgentStatus.NOT_STARTED,
      },
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

/**
 * Atomically update conversation state.
 * Use this helper to make multiple changes to the state object.
 */
export function updateState(
  chatId: string,
  updater: (state: ConversationState) => void,
): void {
  const state = getState(chatId);
  updater(state);
  conversationStates.set(chatId, state);
}

/**
 * Request clarification from the user.
 * This will:
 *  - mark the agent (the currentAgent) as WAITING_FOR_CLARIFICATION,
 *  - set pausedAgent (if not already set),
 *  - clear the currentAgent so supervisor won't think the agent is still running.
 */
export function addClarificationRequest(
  chatId: string,
  request: ClarificationRequest,
): void {
  const state = getState(chatId);

  // The agent that requested clarification is the currentAgent at the moment of request
  const agentName = state.currentAgent;

  if (
    agentName &&
    (agentName as keyof AgentWorkflowState) in state.agentStates
  ) {
    // Mark agent as waiting for clarification
    state.agentStates[agentName as keyof AgentWorkflowState] =
      AgentStatus.WAITING_FOR_CLARIFICATION;

    // Record pausedAgent (first requester wins)
    if (!state.pausedAgent) {
      state.pausedAgent = agentName;
    }

    // Clear currentAgent to indicate the agent is paused (not running)
    state.currentAgent = undefined;
    state.workflowStep = undefined;
  }

  if (!state.isWaitingForClarification) {
    state.pendingClarifications.set(request.id, request);
    state.isWaitingForClarification = true;
  } else {
    state.clarificationQueue.push(request);
  }

  conversationStates.set(chatId, state);
}

/**
 * Add clarification response: store it, remove from pending, process queue.
 * IMPORTANT: Do NOT reset all agent progress here. Keep pausedAgent so supervisor can resume correctly.
 */
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
    `Adding clarification response for request ${response.requestId} in chat with response ${response.answer ?? response.text}`,
  );

  if (state.pendingClarifications.size === 0) {
    // Move queued clarifications into pending, or finish waiting
    const nextRequest = state.clarificationQueue.shift();
    if (nextRequest) {
      state.pendingClarifications.set(nextRequest.id, nextRequest);
      state.isWaitingForClarification = true;
    } else {
      // No more clarifications -> stop waiting, preserve agent progress
      console.log(
        `All clarifications completed for chat ${chatId}. Clearing waiting state (preserve agent progress).`,
      );
      state.isWaitingForClarification = false;

      // Keep pausedAgent as the resume pointer. Supervisor will clear it after resuming.
      // Also ensure currentAgent is cleared (agent is paused and will be resumed by supervisor).
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

/**
 * Return all stored clarification responses as an array (filtered).
 */
export function getAllClarificationResponses(
  chatId: string,
): ClarificationResponse[] {
  const state = getState(chatId);
  return Array.from(state.clarificationHistory.values()).filter(
    Boolean,
  ) as ClarificationResponse[];
}

export function setPausedAgent(chatId: string, agentName?: string): void {
  const state = getState(chatId);
  state.pausedAgent = agentName ?? undefined;
  conversationStates.set(chatId, state);
}

export function getPausedAgent(chatId: string): string | undefined {
  return getState(chatId).pausedAgent;
}

export function clearPausedAgent(chatId: string): void {
  const state = getState(chatId);
  state.pausedAgent = undefined;
  conversationStates.set(chatId, state);
}

export function setCurrentAgent(
  chatId: string,
  agentName: string,
  step?: string,
): void {
  const state = getState(chatId);
  state.currentAgent = agentName;
  state.workflowStep = step;

  if ((agentName as keyof AgentWorkflowState) in state.agentStates) {
    state.agentStates[agentName as keyof AgentWorkflowState] =
      AgentStatus.RUNNING;
  }

  conversationStates.set(chatId, state);
}


export function clearCurrentAgent(chatId: string): void {
  const state = getState(chatId);
  const current = state.currentAgent;
  if (current) {
    if (
      state.agentStates[current as keyof AgentWorkflowState] ===
      AgentStatus.RUNNING
    ) {
      state.agentStates[current as keyof AgentWorkflowState] =
        AgentStatus.NOT_STARTED;
    }
  }
  state.currentAgent = undefined;
  state.workflowStep = undefined;
  conversationStates.set(chatId, state);
}

export function clearState(chatId: string): void {
  conversationStates.delete(chatId);
}

export function getCurrentAgent(chatId: string): string | undefined {
  return getState(chatId).currentAgent;
}

export function getWorkflowPhase(chatId: string): WorkflowPhase {
  return getState(chatId).workflowPhase;
}

export function isWorkflowComplete(chatId: string): boolean {
  const state = getState(chatId);
  return state.workflowPhase === WorkflowPhase.COMPLETED;
}

export function getNextAgent(chatId: string): string | null {
  const state = getState(chatId);
  const { core_agent, diagram_agent, terraform_agent } = state.agentStates;

  console.log(`getNextAgent for ${chatId}:`, {
    core_agent,
    diagram_agent,
    terraform_agent,
    currentAgent: state.currentAgent,
    isWaiting: state.isWaitingForClarification,
    pausedAgent: state.pausedAgent,
  });

  if (
    core_agent === AgentStatus.NOT_STARTED ||
    core_agent === AgentStatus.WAITING_FOR_CLARIFICATION
  ) {
    return 'core_agent';
  } else if (
    core_agent === AgentStatus.COMPLETED &&
    (diagram_agent === AgentStatus.NOT_STARTED ||
      diagram_agent === AgentStatus.WAITING_FOR_CLARIFICATION)
  ) {
    return 'diagram_agent';
  } else if (
    diagram_agent === AgentStatus.COMPLETED &&
    (terraform_agent === AgentStatus.NOT_STARTED ||
      terraform_agent === AgentStatus.WAITING_FOR_CLARIFICATION)
  ) {
    return 'terraform_agent';
  } else if (terraform_agent === AgentStatus.COMPLETED) {
    return null; // Workflow complete
  }

  const currentAgent = state.currentAgent;
  if (
    currentAgent &&
    state.agentStates[currentAgent as keyof AgentWorkflowState] ===
      AgentStatus.RUNNING
  ) {
    return currentAgent;
  }

  return null;
}

export function markAgentCompleted(chatId: string, agentName: string): void {
  const state = getState(chatId);
  if ((agentName as keyof AgentWorkflowState) in state.agentStates) {
    state.agentStates[agentName as keyof AgentWorkflowState] =
      AgentStatus.COMPLETED;
    updateWorkflowPhase(state);
    conversationStates.set(chatId, state);
    console.log(`Agent ${agentName} status updated to completed`);
  }
}

export function getWorkflowProgress(chatId: string): {
  completedAgents: string[];
} {
  const state = getState(chatId);
  const completedAgents: string[] = [];

  Object.entries(state.agentStates).forEach(([agentName, status]) => {
    if (status === AgentStatus.COMPLETED) {
      completedAgents.push(agentName);
    }
  });

  return { completedAgents };
}

function updateWorkflowPhase(state: ConversationState): void {
  const { core_agent, diagram_agent, terraform_agent } = state.agentStates;

  if (terraform_agent === AgentStatus.COMPLETED) {
    state.workflowPhase = WorkflowPhase.COMPLETED;
  } else if (
    terraform_agent === AgentStatus.RUNNING ||
    diagram_agent === AgentStatus.COMPLETED
  ) {
    state.workflowPhase = WorkflowPhase.IMPLEMENTATION;
  } else if (
    diagram_agent === AgentStatus.RUNNING ||
    core_agent === AgentStatus.COMPLETED
  ) {
    state.workflowPhase = WorkflowPhase.DESIGN;
  } else {
    state.workflowPhase = WorkflowPhase.PLANNING;
  }
}

export const ConversationStateManager = {
  getState,
  updateState,
  addClarificationRequest,
  addClarificationResponse,
  isWaitingForClarification,
  getPendingClarifications,
  getClarificationResponse,
  getAllClarificationResponses,
  setPausedAgent,
  getPausedAgent,
  clearPausedAgent,
  setCurrentAgent,
  clearCurrentAgent,
  clearState,
  getCurrentAgent,
  getWorkflowPhase,
  isWorkflowComplete,
  getNextAgent,
  markAgentCompleted,
  getWorkflowProgress,
};
