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

export type AgentName = 'core_agent' | 'diagram_agent' | 'terraform_agent';

export interface AgentWorkflowState {
  core_agent: AgentStatus;
  diagram_agent: AgentStatus;
  terraform_agent: AgentStatus;
}

export interface ConversationState {
  chatId: string;

  // workflow/adhoc
  mode: 'workflow' | 'adhoc';
  workflowPointer: number; // index into AGENT_ORDER
  workflowPhase: WorkflowPhase;

  // running/paused
  currentAgent?: AgentName; // agent currently running (or to resume)
  activeAskingAgent?: AgentName; // agent that most recently asked

  // agent statuses
  agentStates: AgentWorkflowState;
  // clarifications
  isWaitingForClarification: boolean;
  pendingClarifications: Map<string, ClarificationRequest>; // id -> request
  clarificationHistory: Map<string, ClarificationResponse>; // requestId -> last response

  // optional UI step detail
  workflowStep?: string;
}

const AGENT_ORDER: AgentName[] = [
  'core_agent',
  'diagram_agent',
  'terraform_agent',
];

// In-memory store (swap for Redis/DB in prod)
const conversationStates = new Map<string, ConversationState>();

export function getState(chatId: string): ConversationState {
  if (!conversationStates.has(chatId)) {
    conversationStates.set(chatId, {
      chatId,
      mode: 'workflow',
      workflowPointer: 0,
      workflowPhase: WorkflowPhase.PLANNING,
      currentAgent: undefined,
      activeAskingAgent: undefined,
      agentStates: {
        core_agent: AgentStatus.NOT_STARTED,
        diagram_agent: AgentStatus.NOT_STARTED,
        terraform_agent: AgentStatus.NOT_STARTED,
      },
      isWaitingForClarification: false,
      pendingClarifications: new Map(),
      clarificationHistory: new Map(),
      workflowStep: undefined,
    });
  }
  const s = conversationStates.get(chatId);
  if (!s)
    throw new Error(`Failed to get conversation state for chat ${chatId}`);
  return s;
}

export function updateState(
  chatId: string,
  updater: (s: ConversationState) => void,
): void {
  const s = getState(chatId);
  updater(s);
  conversationStates.set(chatId, s);
}

export function clearState(chatId: string): void {
  conversationStates.delete(chatId);
}

// ---------- Mode / Phase ----------
export function getMode(chatId: string): ConversationState['mode'] {
  return getState(chatId).mode;
}
export function setMode(chatId: string, mode: ConversationState['mode']): void {
  updateState(chatId, (s) => {
    s.mode = mode;
  });
}

export function getWorkflowPhase(chatId: string): WorkflowPhase {
  return getState(chatId).workflowPhase;
}
export function isWorkflowComplete(chatId: string): boolean {
  return getState(chatId).workflowPhase === WorkflowPhase.COMPLETED;
}

export function resetWorkflow(chatId: string): void {
  updateState(chatId, (s) => {
    s.mode = 'workflow';
    s.workflowPointer = 0;
    s.workflowPhase = WorkflowPhase.PLANNING;
    s.currentAgent = undefined;
    s.activeAskingAgent = undefined;

    s.agentStates.core_agent = AgentStatus.NOT_STARTED;
    s.agentStates.diagram_agent = AgentStatus.NOT_STARTED;
    s.agentStates.terraform_agent = AgentStatus.NOT_STARTED;

    s.isWaitingForClarification = false;
    s.pendingClarifications.clear();
    // keep clarificationHistory for audit (optional)
    s.workflowStep = undefined;
  });
}

// ---------- Agent run pointers ----------
export function getCurrentAgent(chatId: string): AgentName | undefined {
  return getState(chatId).currentAgent;
}
export function setCurrentAgent(
  chatId: string,
  agentName: AgentName,
  step?: string,
): void {
  updateState(chatId, (s) => {
    s.currentAgent = agentName;
    s.workflowStep = step;
    if ((agentName as keyof AgentWorkflowState) in s.agentStates) {
      s.agentStates[agentName] = AgentStatus.RUNNING;
    }
  });
}
export function clearCurrentAgent(chatId: string): void {
  updateState(chatId, (s) => {
    const current = s.currentAgent;
    if (current && s.agentStates[current] === AgentStatus.RUNNING) {
      s.agentStates[current] = AgentStatus.NOT_STARTED;
    }
    s.currentAgent = undefined;
    s.workflowStep = undefined;
  });
}

// ---------- Clarifications ----------
export function addClarificationRequest(
  chatId: string,
  request: ClarificationRequest,
): void {
  updateState(chatId, (s) => {
    const agent = (request.agentName as AgentName) ?? 'core_agent';
    if ((agent as keyof AgentWorkflowState) in s.agentStates) {
      s.agentStates[agent] = AgentStatus.WAITING_FOR_CLARIFICATION;
    }
    s.activeAskingAgent = agent;
    s.currentAgent = undefined; // pause
    s.workflowStep = undefined;
    s.pendingClarifications.set(request.id, request);
    s.isWaitingForClarification = true;
  });
}

export function addClarificationResponse(
  chatId: string,
  response: ClarificationResponse,
): void {
  updateState(chatId, (s) => {
    const reqId = response.requestId;
    s.clarificationHistory.set(reqId, response);
    const req = s.pendingClarifications.get(reqId);
    s.pendingClarifications.delete(reqId);
    if (s.pendingClarifications.size === 0) {
      s.isWaitingForClarification = false;
      const resumeAgent =
        (req?.agentName as AgentName | undefined) ??
        (response.agentName as AgentName | undefined) ??
        s.activeAskingAgent ??
        s.currentAgent;
      if (resumeAgent) {
        s.currentAgent = resumeAgent;
        s.agentStates[resumeAgent] = AgentStatus.RUNNING;
      }
      s.activeAskingAgent = undefined;
    } else {
      s.isWaitingForClarification = true; // still waiting on others
    }
  });
}

export function isWaitingForClarification(chatId: string): boolean {
  return getState(chatId).isWaitingForClarification;
}
export function getPendingClarifications(
  chatId: string,
): ClarificationRequest[] {
  return Array.from(getState(chatId).pendingClarifications.values());
}
export function getClarificationResponse(
  chatId: string,
  requestId: string,
): ClarificationResponse | undefined {
  return getState(chatId).clarificationHistory.get(requestId);
}
export function getAllClarificationResponses(
  chatId: string,
): ClarificationResponse[] {
  return Array.from(getState(chatId).clarificationHistory.values());
}

export function getClarificationRequest(
  chatId: string,
  requestId: string,
): ClarificationRequest | undefined {
  return getState(chatId).pendingClarifications.get(requestId);
}

export function markClarificationResolved(
  chatId: string,
  requestId: string,
): void {
  updateState(chatId, (s) => {
    s.pendingClarifications.delete(requestId);
    if (s.pendingClarifications.size === 0) {
      s.isWaitingForClarification = false;
      if (s.activeAskingAgent) {
        s.currentAgent = s.activeAskingAgent;
        s.agentStates[s.activeAskingAgent] = AgentStatus.RUNNING;
        s.activeAskingAgent = undefined;
      }
    }
  });
}

/** Reconcile invariants after out-of-band updates */
export function reconcileAfterClarificationIfNeeded(chatId: string): void {
  updateState(chatId, (s) => {
    if (s.pendingClarifications.size > 0) {
      s.isWaitingForClarification = true;
      if (
        s.activeAskingAgent &&
        s.agentStates[s.activeAskingAgent] !==
          AgentStatus.WAITING_FOR_CLARIFICATION
      ) {
        s.agentStates[s.activeAskingAgent] =
          AgentStatus.WAITING_FOR_CLARIFICATION;
      }
      return;
    }
    if (s.isWaitingForClarification) {
      s.isWaitingForClarification = false;
      if (s.activeAskingAgent) {
        s.currentAgent = s.activeAskingAgent;
        s.agentStates[s.activeAskingAgent] = AgentStatus.RUNNING;
        s.activeAskingAgent = undefined;
      }
    }
  });
}
// ---------- Next / Completed ----------
export function getNextAgent(chatId: string): AgentName | null {
  const s = getState(chatId);
  if (s.isWaitingForClarification) {
    return null; // paused
  }
  // continue running agent
  if (s.currentAgent && s.agentStates[s.currentAgent] === AgentStatus.RUNNING) {
    return s.currentAgent;
  }
  if (s.mode === 'workflow') {
    for (let i = s.workflowPointer; i < AGENT_ORDER.length; i++) {
      const a = AGENT_ORDER[i];
      const st = s.agentStates[a];
      if (
        st === AgentStatus.NOT_STARTED ||
        st === AgentStatus.WAITING_FOR_CLARIFICATION ||
        st === AgentStatus.RUNNING
      ) {
        return a;
      }
    }
    return null;
  }
  // adhoc: no predetermined "next"
  return null;
}

export function markAgentCompleted(chatId: string, agentName: AgentName): void {
  updateState(chatId, (s) => {
    if (!(agentName in s.agentStates)) return;
    s.agentStates[agentName] = AgentStatus.COMPLETED;

    const expected = AGENT_ORDER[s.workflowPointer];
    if (s.mode === 'workflow' && expected === agentName) {
      s.workflowPointer = Math.min(s.workflowPointer + 1, AGENT_ORDER.length);
    }
    updateWorkflowPhase(s);
  });
}

export function getWorkflowProgress(chatId: string): {
  completedAgents: string[];
} {
  const s = getState(chatId);
  const completedAgents: string[] = [];
  (Object.entries(s.agentStates) as [AgentName, AgentStatus][]).forEach(
    ([name, status]) => {
      if (status === AgentStatus.COMPLETED) completedAgents.push(name);
    },
  );
  return { completedAgents };
}

function updateWorkflowPhase(s: ConversationState): void {
  const { core_agent, diagram_agent, terraform_agent } = s.agentStates;
  if (terraform_agent === AgentStatus.COMPLETED) {
    s.workflowPhase = WorkflowPhase.COMPLETED;
  } else if (
    terraform_agent === AgentStatus.RUNNING ||
    diagram_agent === AgentStatus.COMPLETED
  ) {
    s.workflowPhase = WorkflowPhase.IMPLEMENTATION;
  } else if (
    diagram_agent === AgentStatus.RUNNING ||
    core_agent === AgentStatus.COMPLETED
  ) {
    s.workflowPhase = WorkflowPhase.DESIGN;
  } else {
    s.workflowPhase = WorkflowPhase.PLANNING;
  }
}

export const ConversationStateManager = {
  // state
  getState,
  updateState,
  clearState,
  // mode/phase
  getMode,
  setMode,
  getWorkflowPhase,
  isWorkflowComplete,
  resetWorkflow,
  // agents
  getCurrentAgent,
  setCurrentAgent,
  clearCurrentAgent,
  getNextAgent,
  markAgentCompleted,
  getWorkflowProgress,
  // clarifications
  isWaitingForClarification,
  getPendingClarifications,
  getClarificationRequest,
  getClarificationResponse,
  getAllClarificationResponses,
  addClarificationRequest,
  addClarificationResponse,
  markClarificationResolved,
  reconcileAfterClarificationIfNeeded,
};
