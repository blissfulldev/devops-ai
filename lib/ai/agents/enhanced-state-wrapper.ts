import {
  EnhancedStateManager,
  WorkflowOrchestrator,
  GuidanceGenerator,
  WorkflowActionHandler,
} from '../enhanced-conversation-state';
import type {
  AgentStatus,
  WorkflowPhase,
  AgentName,
} from '../conversation-state';

/**
 * Get enhanced state with base state interface compatibility
 */
export function getState(chatId: string) {
  const enhancedState = EnhancedStateManager.getEnhancedState(chatId);
  // Return base state interface for compatibility
  return {
    mode: enhancedState.mode,
    workflowPointer: enhancedState.workflowPointer,
    workflowPhase: enhancedState.workflowPhase,
    currentAgent: enhancedState.currentAgent,
    activeAskingAgent: enhancedState.activeAskingAgent,
    agentStates: enhancedState.agentStates,
    isWaitingForClarification: enhancedState.isWaitingForClarification,
    workflowStep: enhancedState.workflowStep,
    pendingClarifications: enhancedState.pendingClarifications,
    clarificationHistory: enhancedState.clarificationHistory,
    workflowCompleted: enhancedState.workflowCompleted,
  };
}

/**
 * Update workflow phase with enhanced state management
 */
export function updateWorkflowPhase(
  chatId: string,
  phase: WorkflowPhase,
): void {
  EnhancedStateManager.updateWorkflowPhase(chatId, phase);
}

/**
 * Update current agent with enhanced state management
 */
export function updateCurrentAgent(chatId: string, agentName: AgentName): void {
  EnhancedStateManager.updateCurrentAgent(chatId, agentName);
}

/**
 * Update agent status with enhanced state management
 */
export function updateAgentStatus(
  chatId: string,
  agentName: AgentName,
  status: AgentStatus,
): void {
  EnhancedStateManager.updateAgentStatus(chatId, agentName, status);
}

/**
 * Set workflow completion status
 */
export function setWorkflowCompleted(chatId: string, completed: boolean): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      state.workflowCompleted = completed;
    },
    `Workflow completion status set to: ${completed}`,
  );
}

/**
 * Add clarification request with enhanced tracking
 */
export function addClarificationRequest(
  chatId: string,
  request: any,
  agentName: AgentName,
): void {
  EnhancedStateManager.addClarificationRequest(chatId, request, agentName);
}

/**
 * Add clarification response with enhanced tracking
 */
export function addClarificationResponse(
  chatId: string,
  response: any,
  agentName: AgentName,
): void {
  EnhancedStateManager.addClarificationResponse(chatId, response, agentName);
}

/**
 * Set waiting for clarification status
 */
export function setWaitingForClarification(
  chatId: string,
  waiting: boolean,
  agentName?: AgentName,
): void {
  EnhancedStateManager.setWaitingForClarification(chatId, waiting, agentName);
}

/**
 * Update workflow step with enhanced tracking
 */
export function updateWorkflowStep(
  chatId: string,
  step: string,
  agentName: AgentName,
): void {
  EnhancedStateManager.updateWorkflowStep(chatId, step, agentName);
}

/**
 * Get workflow orchestration recommendations
 */
export async function getWorkflowRecommendations(
  chatId: string,
  modelId: string,
): Promise<any> {
  return await WorkflowOrchestrator.analyzeWorkflowState(chatId, modelId);
}

/**
 * Generate user guidance for current state
 */
export async function generateUserGuidance(
  chatId: string,
  modelId: string,
  userLevel: 'beginner' | 'intermediate' | 'advanced' = 'intermediate',
): Promise<any> {
  return await GuidanceGenerator.generateUserGuidance(chatId, modelId, {
    userLevel,
  });
}

/**
 * Execute workflow action with enhanced handling
 */
export async function executeWorkflowAction(
  chatId: string,
  action: any,
  modelId: string,
): Promise<any> {
  return await WorkflowActionHandler.executeAction(chatId, action, modelId);
}

/**
 * Get enhanced state metrics and insights
 */
export function getStateMetrics(chatId: string) {
  const state = EnhancedStateManager.getEnhancedState(chatId);
  return {
    totalTransitions: state.stateTransitionLog.length,
    clarificationCount: state.pendingClarifications.length,
    responseCount: state.clarificationResponses.length,
    workflowSteps: state.workflowSteps.length,
    completedSteps: state.workflowSteps.filter((s) => s.status === 'completed')
      .length,
    lastActivity: state.lastActivity,
    performanceMetrics: state.performanceMetrics,
  };
}

/**
 * Perform state validation and health check
 */
export function validateState(chatId: string): {
  isValid: boolean;
  issues: string[];
  recommendations: string[];
} {
  const state = EnhancedStateManager.getEnhancedState(chatId);
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check for common state issues
  if (
    state.isWaitingForClarification &&
    state.pendingClarifications.length === 0
  ) {
    issues.push(
      'Waiting for clarification but no pending clarifications found',
    );
    recommendations.push('Reset clarification waiting status');
  }

  if (state.currentAgent && !state.agentStates[state.currentAgent]) {
    issues.push(`Current agent ${state.currentAgent} has no state record`);
    recommendations.push('Initialize agent state or reset current agent');
  }

  if (state.workflowSteps.length > 0) {
    const activeSteps = state.workflowSteps.filter(
      (s) => s.status === 'active',
    );
    if (activeSteps.length > 1) {
      issues.push('Multiple active workflow steps detected');
      recommendations.push('Ensure only one step is active at a time');
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    recommendations,
  };
}
