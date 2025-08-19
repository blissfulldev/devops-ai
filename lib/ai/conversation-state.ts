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
  agentStates: AgentWorkflowState;
  isWaitingForClarification: boolean;
  pendingClarifications: Map<string, ClarificationRequest>;
  clarificationHistory: Map<string, ClarificationResponse>;
  clarificationQueue: ClarificationRequest[];
  workflowStep?: string;
}

// In-memory store for conversation states (in production, use Redis or database)
const conversationStates = new Map<string, ConversationState>();

function getState(chatId: string): ConversationState {
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

export function addClarificationRequest(
  chatId: string,
  request: ClarificationRequest,
): void {
  const state = getState(chatId);

  // Mark current agent as waiting for clarification
  const agentName = state.currentAgent as keyof AgentWorkflowState;
  if (agentName in state.agentStates) {
    state.agentStates[agentName] = AgentStatus.WAITING_FOR_CLARIFICATION;
  }

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
      console.log(
        `All clarifications completed for chat ${chatId}, resetting workflow state`,
      );
      state.isWaitingForClarification = false;

      // Reset ALL agent statuses to NOT_STARTED to ensure clean workflow restart
      state.agentStates.core_agent = AgentStatus.NOT_STARTED;
      state.agentStates.diagram_agent = AgentStatus.NOT_STARTED;
      state.agentStates.terraform_agent = AgentStatus.NOT_STARTED;
      state.workflowPhase = WorkflowPhase.PLANNING;

      console.log(`Reset all agent states to NOT_STARTED for chat ${chatId}`);

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

/**
 * Return all stored clarification responses (array form).
 */
export function getAllClarificationResponses(
  chatId: string,
): ClarificationResponse[] {
  const state = getState(chatId);
  return Array.from(state.clarificationHistory.values());
}

export function setCurrentAgent(
  chatId: string,
  agentName: string,
  step?: string,
): void {
  const state = getState(chatId);
  state.currentAgent = agentName;
  state.workflowStep = step;

  // Mark the current agent as running
  if (agentName in state.agentStates) {
    state.agentStates[agentName as keyof AgentWorkflowState] =
      AgentStatus.RUNNING;
  }

  conversationStates.set(chatId, state);
}

/**
 * Clear the current agent (e.g. on error) and set its status back to NOT_STARTED if it was RUNNING.
 */
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

// Workflow management functions
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
  });

  // Workflow progression rules
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

  // If current agent is still running, return it
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
  if (agentName in state.agentStates) {
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

// Export as ConversationStateManager for backward compatibility
export const ConversationStateManager = {
  getState,
  addClarificationRequest,
  addClarificationResponse,
  isWaitingForClarification,
  getPendingClarifications,
  getClarificationResponse,
  getAllClarificationResponses,
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
