import type { AgentName, WorkflowPhase } from '../conversation-state';
import type {
  WorkflowStep,
  StepExecution,
  StepStatus,
  ProgressInfo,
} from './types';
import { EnhancedStateManager } from './enhanced-state-manager';

/**
 * Create a new workflow step
 */
export function createStep(
  id: string,
  name: string,
  description: string,
  agentName: AgentName,
  options: Partial<WorkflowStep> = {},
): WorkflowStep {
  return {
    id,
    name,
    description,
    agentName,
    status: 'pending',
    estimatedDuration: 300, // 5 minutes default
    dependencies: [],
    userInputRequired: true,
    isOptional: false,
    ...options,
  };
}

/**
 * Add a new step to the workflow
 */
export function addStep(chatId: string, step: WorkflowStep): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      // Check if step already exists
      const existingIndex = state.workflowSteps.findIndex(
        (s) => s.id === step.id,
      );
      if (existingIndex !== -1) {
        state.workflowSteps[existingIndex] = step;
      } else {
        state.workflowSteps.push(step);
      }
    },
    `Added workflow step: ${step.id}`,
    step.agentName,
  );
}

/**
 * Update step status with automatic timestamp management
 */
export function updateStepStatus(
  chatId: string,
  stepId: string,
  status: StepStatus,
  agentName?: AgentName,
): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      const step = state.workflowSteps.find((s) => s.id === stepId);
      if (!step) {
        console.warn(`Step ${stepId} not found`);
        return;
      }

      const oldStatus = step.status;
      step.status = status;

      // Automatic timestamp management
      const now = new Date().toISOString();

      if (status === 'active' && !step.startTime) {
        step.startTime = now;

        // Create step execution record
        const execution: StepExecution = {
          stepId,
          startTime: now,
          status,
          clarificationsRequested: 0,
          clarificationsAnswered: 0,
        };
        state.stepExecutionHistory.push(execution);
      }

      if (
        (status === 'completed' ||
          status === 'failed' ||
          status === 'skipped') &&
        !step.endTime
      ) {
        step.endTime = now;

        // Update execution record
        const execution = state.stepExecutionHistory.find(
          (e) => e.stepId === stepId && !e.endTime,
        );
        if (execution) {
          execution.endTime = now;
          execution.status = status;
        }
      }

      console.log(
        `[WorkflowStepTracker] Step ${stepId} status: ${oldStatus} -> ${status}`,
      );
    },
    `Updated step ${stepId} status to ${status}`,
    agentName,
  );
}

/**
 * Start a workflow step
 */
export function startStep(
  chatId: string,
  stepId: string,
  agentName?: AgentName,
): void {
  updateStepStatus(chatId, stepId, 'active', agentName);
}

/**
 * Complete a workflow step
 */
export function completeStep(
  chatId: string,
  stepId: string,
  agentName?: AgentName,
): void {
  updateStepStatus(chatId, stepId, 'completed', agentName);
}

/**
 * Fail a workflow step
 */
export function failStep(
  chatId: string,
  stepId: string,
  error?: string,
  agentName?: AgentName,
): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      const step = state.workflowSteps.find((s) => s.id === stepId);
      if (step && error) {
        // Store error information
        const execution = state.stepExecutionHistory.find(
          (e) => e.stepId === stepId && !e.endTime,
        );
        if (execution) {
          execution.errors = execution.errors || [];
          execution.errors.push(error);
        }
      }
    },
    `Failed step ${stepId}: ${error || 'Unknown error'}`,
    agentName,
  );

  updateStepStatus(chatId, stepId, 'failed', agentName);
}

/**
 * Skip a workflow step
 */
export function skipStep(
  chatId: string,
  stepId: string,
  reason?: string,
  agentName?: AgentName,
): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      const step = state.workflowSteps.find((s) => s.id === stepId);
      if (step && reason) {
        step.skipReason = reason;
      }
    },
    `Skipped step ${stepId}: ${reason || 'No reason provided'}`,
    agentName,
  );

  updateStepStatus(chatId, stepId, 'skipped', agentName);
}

/**
 * Get current active step
 */
export function getCurrentStep(chatId: string): WorkflowStep | undefined {
  return EnhancedStateManager.getCurrentWorkflowStep(chatId);
}

/**
 * Get all workflow steps
 */
export function getAllSteps(chatId: string): WorkflowStep[] {
  return EnhancedStateManager.getWorkflowSteps(chatId);
}

/**
 * Get steps by status
 */
export function getStepsByStatus(
  chatId: string,
  status: StepStatus,
): WorkflowStep[] {
  const allSteps = getAllSteps(chatId);
  return allSteps.filter((step) => step.status === status);
}

/**
 * Get steps by agent
 */
export function getStepsByAgent(
  chatId: string,
  agentName: AgentName,
): WorkflowStep[] {
  const allSteps = getAllSteps(chatId);
  return allSteps.filter((step) => step.agentName === agentName);
}

/**
 * Check if step dependencies are satisfied
 */
export function areDependenciesSatisfied(
  chatId: string,
  stepId: string,
): boolean {
  const allSteps = getAllSteps(chatId);
  const step = allSteps.find((s) => s.id === stepId);

  if (!step || step.dependencies.length === 0) {
    return true;
  }

  return step.dependencies.every((depId) => {
    const depStep = allSteps.find((s) => s.id === depId);
    return depStep?.status === 'completed';
  });
}

/**
 * Get next available step (dependencies satisfied, not started)
 */
export function getNextAvailableStep(chatId: string): WorkflowStep | undefined {
  const allSteps = getAllSteps(chatId);

  return allSteps.find(
    (step) =>
      step.status === 'pending' && areDependenciesSatisfied(chatId, step.id),
  );
}

/**
 * Get steps ready to start (dependencies satisfied)
 */
export function getReadySteps(chatId: string): WorkflowStep[] {
  const allSteps = getAllSteps(chatId);

  return allSteps.filter(
    (step) =>
      step.status === 'pending' && areDependenciesSatisfied(chatId, step.id),
  );
}

/**
 * Calculate workflow progress
 */
export function calculateProgress(chatId: string): ProgressInfo {
  const allSteps = getAllSteps(chatId);
  const completedSteps = allSteps.filter(
    (step) => step.status === 'completed',
  ).length;
  const totalSteps = allSteps.length;

  const overallProgress =
    totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  // Calculate phase progress
  const currentPhase = determineCurrentPhase(chatId);
  const phaseSteps = allSteps.filter(
    (step) => getPhaseForAgent(step.agentName) === currentPhase,
  );
  const completedPhaseSteps = phaseSteps.filter(
    (step) => step.status === 'completed',
  ).length;
  const phaseProgress =
    phaseSteps.length > 0 ? (completedPhaseSteps / phaseSteps.length) * 100 : 0;

  // Estimate time remaining
  const pendingSteps = allSteps.filter((step) => step.status === 'pending');
  const estimatedTimeRemaining = pendingSteps.reduce(
    (total, step) => total + step.estimatedDuration,
    0,
  );

  return {
    overallProgress,
    currentPhase,
    phaseProgress,
    completedSteps,
    totalSteps,
    estimatedTimeRemaining,
    nextStep: getNextAvailableStep(chatId),
  };
}

/**
 * Determine current workflow phase based on active/completed steps
 */
function determineCurrentPhase(chatId: string): WorkflowPhase {
  const allSteps = getAllSteps(chatId);
  const activeStep = allSteps.find((s) => s.status === 'active');

  if (activeStep) {
    return getPhaseForAgent(activeStep.agentName);
  }

  // If no active step, find the next pending step
  const nextStep = getNextAvailableStep(chatId);
  if (nextStep) {
    return getPhaseForAgent(nextStep.agentName);
  }

  // Check if all steps are completed
  const allCompleted = allSteps.every(
    (step) => step.status === 'completed' || step.status === 'skipped',
  );
  if (allCompleted) {
    return 'completed';
  }

  // Default to planning phase
  return 'planning';
}

/**
 * Map agent to workflow phase
 */
function getPhaseForAgent(agentName: AgentName): WorkflowPhase {
  const phaseMap: Record<AgentName, WorkflowPhase> = {
    core_agent: 'planning',
    diagram_agent: 'design',
    terraform_agent: 'implementation',
  };
  return phaseMap[agentName] || 'planning';
}

/**
 * Record clarification request for a step
 */
export function recordClarificationRequest(
  chatId: string,
  stepId: string,
): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      const execution = state.stepExecutionHistory.find(
        (e) => e.stepId === stepId && !e.endTime,
      );
      if (execution) {
        execution.clarificationsRequested++;
      }
    },
    `Recorded clarification request for step: ${stepId}`,
  );
}

/**
 * Record clarification response for a step
 */
export function recordClarificationResponse(
  chatId: string,
  stepId: string,
): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      const execution = state.stepExecutionHistory.find(
        (e) => e.stepId === stepId && !e.endTime,
      );
      if (execution) {
        execution.clarificationsAnswered++;
      }
    },
    `Recorded clarification response for step: ${stepId}`,
  );
}

/**
 * Get step execution history
 */
export function getStepExecutionHistory(chatId: string): StepExecution[] {
  const state = EnhancedStateManager.getEnhancedState(chatId);
  return [...state.stepExecutionHistory];
}

/**
 * Get execution for a specific step
 */
export function getStepExecution(
  chatId: string,
  stepId: string,
): StepExecution | undefined {
  const history = getStepExecutionHistory(chatId);
  return history.find((e) => e.stepId === stepId);
}

/**
 * Get workflow statistics
 */
export function getWorkflowStats(chatId: string): {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  averageStepDuration: number;
  totalClarifications: number;
  clarificationResponseRate: number;
  byAgent: Record<AgentName, { total: number; completed: number }>;
} {
  const allSteps = getAllSteps(chatId);
  const executions = getStepExecutionHistory(chatId);

  const completedSteps = allSteps.filter(
    (s) => s.status === 'completed',
  ).length;
  const failedSteps = allSteps.filter((s) => s.status === 'failed').length;
  const skippedSteps = allSteps.filter((s) => s.status === 'skipped').length;

  // Calculate average step duration
  const completedExecutions = executions.filter(
    (e) => e.endTime && e.startTime,
  );
  const totalDuration = completedExecutions.reduce((sum, e) => {
    const duration =
      e.endTime && e.startTime
        ? new Date(e.endTime).getTime() - new Date(e.startTime).getTime()
        : 0;
    return sum + duration;
  }, 0);
  const averageStepDuration =
    completedExecutions.length > 0
      ? totalDuration / completedExecutions.length / 1000 // Convert to seconds
      : 0;

  // Calculate clarification statistics
  const totalClarifications = executions.reduce(
    (sum, e) => sum + e.clarificationsRequested,
    0,
  );
  const totalResponses = executions.reduce(
    (sum, e) => sum + e.clarificationsAnswered,
    0,
  );
  const clarificationResponseRate =
    totalClarifications > 0 ? totalResponses / totalClarifications : 1;

  // Calculate by-agent statistics
  const byAgent: Record<AgentName, { total: number; completed: number }> = {
    core_agent: { total: 0, completed: 0 },
    diagram_agent: { total: 0, completed: 0 },
    terraform_agent: { total: 0, completed: 0 },
  };

  allSteps.forEach((step) => {
    byAgent[step.agentName].total++;
    if (step.status === 'completed') {
      byAgent[step.agentName].completed++;
    }
  });

  return {
    totalSteps: allSteps.length,
    completedSteps,
    failedSteps,
    skippedSteps,
    averageStepDuration,
    totalClarifications,
    clarificationResponseRate,
    byAgent,
  };
}

/**
 * Reset workflow steps (for workflow restart)
 */
export function resetWorkflow(chatId: string): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      // Reset all steps to pending
      state.workflowSteps.forEach((step) => {
        step.status = 'pending';
        step.startTime = undefined;
        step.endTime = undefined;
        step.skipReason = undefined;
      });

      // Clear execution history
      state.stepExecutionHistory = [];
    },
    'Reset workflow steps',
  );
}
