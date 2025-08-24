import { EnhancedStateManager } from '../enhanced-conversation-state';
import {
  AgentStatus,
  WorkflowPhase,
  type AgentName,
} from '../conversation-state';

/**
 * Perform comprehensive state reconciliation with error recovery
 */
export async function performStateReconciliation(
  chatId: string,
  options: {
    forceReset?: boolean;
    preserveUserData?: boolean;
    validateIntegrity?: boolean;
  } = {},
): Promise<{
  success: boolean;
  issuesFound: string[];
  actionsPerformed: string[];
  recommendations: string[];
}> {
  const {
    forceReset = false,
    preserveUserData = true,
    validateIntegrity = true,
  } = options;

  const issuesFound: string[] = [];
  const actionsPerformed: string[] = [];
  const recommendations: string[] = [];

  try {
    const state = EnhancedStateManager.getEnhancedState(chatId);

    // 1. Validate state integrity
    if (validateIntegrity) {
      const integrityIssues = await validateStateIntegrity(chatId);
      issuesFound.push(...integrityIssues.issues);

      if (integrityIssues.issues.length > 0) {
        actionsPerformed.push('Performed state integrity validation');
      }
    }

    // 2. Check for orphaned clarifications
    const orphanedClarifications = findOrphanedClarifications(state);
    if (orphanedClarifications.length > 0) {
      issuesFound.push(
        `Found ${orphanedClarifications.length} orphaned clarifications`,
      );

      if (!preserveUserData || forceReset) {
        clearOrphanedClarifications(chatId, orphanedClarifications);
        actionsPerformed.push('Cleared orphaned clarifications');
      } else {
        recommendations.push('Consider clearing orphaned clarifications');
      }
    }

    // 3. Reconcile agent states
    const agentStateIssues = reconcileAgentStates(chatId);
    if (agentStateIssues.length > 0) {
      issuesFound.push(...agentStateIssues);
      actionsPerformed.push('Reconciled agent states');
    }

    // 4. Validate workflow consistency
    const workflowIssues = validateWorkflowConsistency(chatId);
    if (workflowIssues.length > 0) {
      issuesFound.push(...workflowIssues);

      if (forceReset) {
        resetWorkflowState(chatId);
        actionsPerformed.push('Reset workflow state');
      } else {
        recommendations.push('Consider resetting workflow state');
      }
    }

    // 5. Clean up stale data
    const cleanupResults = performStateCleanup(chatId, { preserveUserData });
    if (cleanupResults.itemsRemoved > 0) {
      actionsPerformed.push(
        `Cleaned up ${cleanupResults.itemsRemoved} stale items`,
      );
    }

    return {
      success: true,
      issuesFound,
      actionsPerformed,
      recommendations,
    };
  } catch (error) {
    console.error('State reconciliation failed:', error);
    return {
      success: false,
      issuesFound: [`Reconciliation failed: ${error}`],
      actionsPerformed,
      recommendations: ['Manual state inspection required'],
    };
  }
}

/**
 * Validate state integrity and detect corruption
 */
async function validateStateIntegrity(chatId: string): Promise<{
  isValid: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  try {
    const state = EnhancedStateManager.getEnhancedState(chatId);

    // Check required fields
    if (!state.sessionId) {
      issues.push('Missing session ID');
    }

    if (!state.userId) {
      issues.push('Missing user ID');
    }

    // Check agent state consistency
    if (state.currentAgent && !state.agentStates[state.currentAgent]) {
      issues.push(
        `Current agent ${state.currentAgent} missing from agent states`,
      );
    }

    // Check workflow phase consistency
    if (state.workflowPhase && state.currentAgent) {
      const expectedPhase = getExpectedPhaseForAgent(state.currentAgent);
      if (expectedPhase && state.workflowPhase !== expectedPhase) {
        issues.push(
          `Workflow phase ${state.workflowPhase} inconsistent with current agent ${state.currentAgent}`,
        );
      }
    }

    // Check clarification consistency
    if (
      state.isWaitingForClarification &&
      state.pendingClarifications.length === 0
    ) {
      issues.push('Waiting for clarification but no pending clarifications');
    }

    // Check workflow step consistency
    const activeSteps = state.workflowSteps.filter(
      (s) => s.status === 'active',
    );
    if (activeSteps.length > 1) {
      issues.push(
        `Multiple active workflow steps: ${activeSteps.map((s) => s.id).join(', ')}`,
      );
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  } catch (error) {
    issues.push(`State validation error: ${error}`);
    return {
      isValid: false,
      issues,
    };
  }
}

/**
 * Find clarifications that are no longer relevant
 */
function findOrphanedClarifications(state: any): string[] {
  const orphaned: string[] = [];

  // Check for clarifications older than 1 hour with no responses
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  state.pendingClarifications.forEach((clarification: any) => {
    const timestamp = new Date(
      clarification.timestamp || clarification.createdAt,
    ).getTime();
    if (timestamp < oneHourAgo) {
      orphaned.push(clarification.id);
    }
  });

  return orphaned;
}

/**
 * Clear orphaned clarifications from state
 */
function clearOrphanedClarifications(
  chatId: string,
  orphanedIds: string[],
): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      state.pendingClarifications = state.pendingClarifications.filter(
        (c: any) => !orphanedIds.includes(c.id),
      );
    },
    `Cleared ${orphanedIds.length} orphaned clarifications`,
  );
}

/**
 * Reconcile agent states and fix inconsistencies
 */
function reconcileAgentStates(chatId: string): string[] {
  const issues: string[] = [];

  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      // Ensure all agents have proper state records
      const requiredAgents: AgentName[] = [
        'core_agent',
        'diagram_agent',
        'terraform_agent',
      ];

      requiredAgents.forEach((agentName) => {
        if (!state.agentStates[agentName]) {
          state.agentStates[agentName] = {
            status: AgentStatus.IDLE,
            lastActivity: new Date().toISOString(),
            workflowStep: '',
            clarificationsPending: 0,
            clarificationsResolved: 0,
          };
          issues.push(`Initialized missing state for ${agentName}`);
        }
      });

      // Reset any agents stuck in invalid states
      Object.entries(state.agentStates).forEach(([agentName, agentState]) => {
        if (
          agentState.status === AgentStatus.RUNNING &&
          agentName !== state.currentAgent
        ) {
          agentState.status = AgentStatus.IDLE;
          issues.push(`Reset stuck running status for ${agentName}`);
        }
      });
    },
    'Agent state reconciliation',
  );

  return issues;
}

/**
 * Validate workflow consistency and detect issues
 */
function validateWorkflowConsistency(chatId: string): string[] {
  const issues: string[] = [];
  const state = EnhancedStateManager.getEnhancedState(chatId);

  // Check for workflow steps without proper sequencing
  const steps = state.workflowSteps;
  if (steps.length > 0) {
    const completedSteps = steps.filter((s) => s.status === 'completed');
    const activeSteps = steps.filter((s) => s.status === 'active');
    const pendingSteps = steps.filter((s) => s.status === 'pending');

    // Check for gaps in workflow progression
    if (
      activeSteps.length === 0 &&
      pendingSteps.length > 0 &&
      !state.workflowCompleted
    ) {
      issues.push('No active steps but pending steps remain');
    }

    // Check for steps with unsatisfied dependencies
    steps.forEach((step) => {
      if (step.status === 'active' && step.dependencies.length > 0) {
        const unsatisfiedDeps = step.dependencies.filter((depId) => {
          const depStep = steps.find((s) => s.id === depId);
          return !depStep || depStep.status !== 'completed';
        });

        if (unsatisfiedDeps.length > 0) {
          issues.push(
            `Step ${step.id} has unsatisfied dependencies: ${unsatisfiedDeps.join(', ')}`,
          );
        }
      }
    });
  }

  return issues;
}

/**
 * Reset workflow state to a clean state
 */
function resetWorkflowState(chatId: string): void {
  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      // Reset workflow steps
      state.workflowSteps.forEach((step) => {
        if (step.status === 'active' || step.status === 'failed') {
          step.status = 'pending';
          step.startTime = undefined;
          step.endTime = undefined;
        }
      });

      // Reset workflow phase to planning
      state.workflowPhase = WorkflowPhase.PLANNING;
      state.workflowCompleted = false;

      // Clear active agent if stuck
      if (state.currentAgent) {
        const agentState = state.agentStates[state.currentAgent];
        if (agentState && agentState.status === AgentStatus.RUNNING) {
          agentState.status = AgentStatus.IDLE;
        }
        state.currentAgent = null;
      }
    },
    'Workflow state reset',
  );
}

/**
 * Clean up stale data from state
 */
function performStateCleanup(
  chatId: string,
  options: { preserveUserData: boolean },
): { itemsRemoved: number } {
  let itemsRemoved = 0;

  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      // Clean up old state transitions (keep last 100)
      if (state.stateTransitionLog.length > 100) {
        const toRemove = state.stateTransitionLog.length - 100;
        state.stateTransitionLog = state.stateTransitionLog.slice(-100);
        itemsRemoved += toRemove;
      }

      // Clean up old step execution history (keep last 50)
      if (state.stepExecutionHistory.length > 50) {
        const toRemove = state.stepExecutionHistory.length - 50;
        state.stepExecutionHistory = state.stepExecutionHistory.slice(-50);
        itemsRemoved += toRemove;
      }

      // Clean up resolved clarifications older than 24 hours
      if (!options.preserveUserData) {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const originalCount = state.clarificationResponses.length;

        state.clarificationResponses = state.clarificationResponses.filter(
          (response: any) => {
            const timestamp = new Date(
              response.timestamp || response.createdAt,
            ).getTime();
            return timestamp >= oneDayAgo;
          },
        );

        itemsRemoved += originalCount - state.clarificationResponses.length;
      }
    },
    `State cleanup - removed ${itemsRemoved} items`,
  );

  return { itemsRemoved };
}

/**
 * Get expected workflow phase for an agent
 */
function getExpectedPhaseForAgent(agentName: AgentName): WorkflowPhase | null {
  const phaseMap: Record<AgentName, WorkflowPhase> = {
    core_agent: WorkflowPhase.PLANNING,
    diagram_agent: WorkflowPhase.DESIGN,
    terraform_agent: WorkflowPhase.IMPLEMENTATION,
  };

  return phaseMap[agentName] || null;
}

/**
 * Perform emergency state reset (use with caution)
 */
export function performEmergencyReset(chatId: string): void {
  console.warn(`Performing emergency state reset for chat ${chatId}`);

  EnhancedStateManager.updateEnhancedState(
    chatId,
    (state) => {
      // Reset all agents to idle
      Object.keys(state.agentStates).forEach((agentName) => {
        state.agentStates[agentName as AgentName] = {
          status: AgentStatus.IDLE,
          lastActivity: new Date().toISOString(),
          workflowStep: '',
          clarificationsPending: 0,
          clarificationsResolved: 0,
        };
      });

      // Clear current agent and workflow state
      state.currentAgent = null;
      state.activeAskingAgent = null;
      state.workflowPhase = WorkflowPhase.PLANNING;
      state.workflowCompleted = false;
      state.isWaitingForClarification = false;

      // Clear all pending clarifications
      state.pendingClarifications = [];

      // Reset workflow steps
      state.workflowSteps.forEach((step) => {
        step.status = 'pending';
        step.startTime = undefined;
        step.endTime = undefined;
      });
    },
    'Emergency state reset performed',
  );
}

/**
 * Get state reconciliation report
 */
export async function getReconciliationReport(chatId: string): Promise<{
  stateHealth: 'healthy' | 'warning' | 'critical';
  issues: Array<{
    type: 'warning' | 'error';
    message: string;
    recommendation: string;
  }>;
  metrics: {
    totalTransitions: number;
    pendingClarifications: number;
    activeSteps: number;
    lastActivity: string;
  };
}> {
  const state = EnhancedStateManager.getEnhancedState(chatId);
  const issues: Array<{
    type: 'warning' | 'error';
    message: string;
    recommendation: string;
  }> = [];

  // Check for critical issues
  const integrityCheck = await validateStateIntegrity(chatId);
  integrityCheck.issues.forEach((issue) => {
    issues.push({
      type: 'error',
      message: issue,
      recommendation: 'Perform state reconciliation',
    });
  });

  // Check for warnings
  if (state.pendingClarifications.length > 5) {
    issues.push({
      type: 'warning',
      message: `High number of pending clarifications: ${state.pendingClarifications.length}`,
      recommendation: 'Review and resolve pending clarifications',
    });
  }

  const activeSteps = state.workflowSteps.filter(
    (s) => s.status === 'active',
  ).length;
  if (activeSteps > 1) {
    issues.push({
      type: 'error',
      message: `Multiple active workflow steps: ${activeSteps}`,
      recommendation: 'Ensure only one step is active at a time',
    });
  }

  // Determine overall health
  const errorCount = issues.filter((i) => i.type === 'error').length;
  const warningCount = issues.filter((i) => i.type === 'warning').length;

  let stateHealth: 'healthy' | 'warning' | 'critical';
  if (errorCount > 0) {
    stateHealth = 'critical';
  } else if (warningCount > 0) {
    stateHealth = 'warning';
  } else {
    stateHealth = 'healthy';
  }

  return {
    stateHealth,
    issues,
    metrics: {
      totalTransitions: state.stateTransitionLog.length,
      pendingClarifications: state.pendingClarifications.length,
      activeSteps,
      lastActivity: state.lastActivity,
    },
  };
}
