import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartQuestionManager } from '@/lib/ai/enhanced-conversation-state/smart-question-manager';
import { UserPreferenceManager } from '@/lib/ai/enhanced-conversation-state/user-preference-manager';
import { UserActionHandler } from '@/lib/ai/enhanced-conversation-state/user-action-handler';
import { WorkflowOrchestrator } from '@/lib/ai/enhanced-conversation-state/workflow-orchestrator';
import { EnhancedStateManager } from '@/lib/ai/enhanced-conversation-state/enhanced-state-manager';
import type { ClarificationRequest, UserAction } from '@/lib/types';

// Mock external dependencies for E2E testing
vi.mock('@/lib/ai/enhanced-conversation-state/ai-sdk-integration', () => ({
  generateStructuredAnalysis: vi.fn(),
  streamToUI: vi.fn(),
}));

vi.mock('@/lib/ai/conversation-state', () => ({
  getConversationState: vi.fn(),
  updateConversationState: vi.fn(),
}));

describe('Enhanced HITL System E2E Tests', () => {
  const mockChatId = 'e2e-test-chat';
  const mockModelId = 'gpt-4';
  const mockDataStream = {
    write: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    EnhancedStateManager.clearState(mockChatId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Complete User Journey: New User Onboarding', () => {
    it('should guide a new user through their first interaction', async () => {
      const { generateStructuredAnalysis, streamToUI } = await import(
        '@/lib/ai/enhanced-conversation-state/ai-sdk-integration'
      );

      // Step 1: New user starts with default preferences
      const initialPreferences =
        UserPreferenceManager.getUserPreferences(mockChatId);
      expect(initialPreferences.autoAdvancePreference).toBe('ask');
      expect(initialPreferences.verbosityLevel).toBe('normal');

      // Step 2: First question arrives
      const firstQuestion: ClarificationRequest = {
        id: 'onboarding-q1',
        agentName: 'core_agent',
        question: 'What type of application are you building?',
        context: 'Initial project setup',
        priority: 'high',
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      // Mock AI enrichment for new user
      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        shouldAsk: true,
        confidence: 0.9,
        reasoning: 'New user needs guidance',
        enrichedQuestion: {
          ...firstQuestion,
          hash: 'app-type-hash',
          contextualHelp: {
            explanation: 'This helps us understand your project requirements',
            whyAsked: 'Different application types have different needs',
            howUsed: "We'll configure tools and suggestions based on this",
            relatedConcepts: ['web app', 'mobile app', 'API'],
            documentationLinks: [],
          },
          examples: [
            'Web application',
            'Mobile app',
            'REST API',
            'Desktop application',
          ],
          validationRules: [],
          dependencies: [],
          relatedQuestions: [],
          followUpActions: [],
        },
      });

      const processResult = await SmartQuestionManager.processQuestion(
        mockChatId,
        firstQuestion,
        mockModelId,
        mockDataStream,
        {
          enableDeduplication: true,
          enableEnrichment: true,
          confidenceThreshold: 0.8,
          userLevel: 'beginner',
        },
      );

      expect(processResult.shouldAsk).toBe(true);
      expect(
        processResult.processedQuestion?.contextualHelp?.explanation,
      ).toContain('helps us understand');
      expect(processResult.processedQuestion?.examples).toContain(
        'Web application',
      );

      // Step 3: User provides answer
      const userAnswer = {
        id: 'answer-1',
        requestId: 'onboarding-q1',
        answer: 'Web application',
        timestamp: '2024-01-01T00:00:00.000Z',
        agentName: 'core_agent',
      };

      // Mock validation
      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        isValid: true,
        confidence: 0.95,
        feedback:
          'Great choice! Web applications are versatile and widely used.',
        suggestions: [],
        qualityScore: 0.9,
      });

      const validationResult = await SmartQuestionManager.validateAnswer(
        mockChatId,
        'onboarding-q1',
        userAnswer,
        mockModelId,
        mockDataStream,
      );

      expect(validationResult.isValid).toBe(true);
      expect(validationResult.feedback).toContain('Great choice');

      // Step 4: Generate follow-up questions
      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        followUpQuestions: [
          {
            id: 'followup-framework',
            question: 'Which web framework would you like to use?',
            context: 'Based on your web application choice',
            priority: 'high',
            agentName: 'core_agent',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'followup-database',
            question: 'Do you need a database for your application?',
            context: 'Data storage requirements',
            priority: 'medium',
            agentName: 'core_agent',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
        reasoning:
          'Generated relevant follow-ups for web application development',
      });

      const followUps = await SmartQuestionManager.generateFollowUpQuestions(
        mockChatId,
        'onboarding-q1',
        mockModelId,
      );

      expect(followUps).toHaveLength(2);
      expect(followUps[0].question).toContain('framework');
      expect(followUps[1].question).toContain('database');

      // Step 5: Check available actions for new user
      const actions = UserActionHandler.getAvailableActions(
        mockChatId,
        mockModelId,
      );
      expect(actions.some((a) => a.type === 'help')).toBe(true);
      expect(actions.some((a) => a.type === 'modify')).toBe(true);

      // Verify state was properly maintained
      const finalState = EnhancedStateManager.getEnhancedState(mockChatId);
      expect(finalState.questionHistory.has('app-type-hash')).toBe(true);
      expect(finalState.questionHistory.get('app-type-hash')?.answer).toEqual(
        userAnswer,
      );
    });
  });

  describe('Complete User Journey: Experienced User Workflow', () => {
    it('should handle an experienced user with custom preferences', async () => {
      const { generateStructuredAnalysis } = await import(
        '@/lib/ai/enhanced-conversation-state/ai-sdk-integration'
      );

      // Step 1: Set up experienced user preferences
      UserPreferenceManager.setUserPreferences(mockChatId, {
        autoAdvancePreference: 'always',
        verbosityLevel: 'minimal',
        skipOptionalSteps: true,
        preferredQuestionFormat: 'open_ended',
        timeoutForAutoAdvance: 15, // Quick timeout
      });

      // Step 2: Initialize workflow state
      EnhancedStateManager.updateEnhancedState(mockChatId, (state) => ({
        ...state,
        workflowPhase: 'implementation',
        currentAgent: 'code_agent',
        workflowSteps: [
          {
            id: 'setup',
            name: 'Project Setup',
            status: 'completed',
            isOptional: false,
          },
          {
            id: 'optional-docs',
            name: 'Documentation Generation',
            status: 'pending',
            isOptional: true,
          },
          {
            id: 'implementation',
            name: 'Core Implementation',
            status: 'active',
            isOptional: false,
          },
        ],
      }));

      // Step 3: Process question with minimal enrichment
      const technicalQuestion: ClarificationRequest = {
        id: 'tech-q1',
        agentName: 'code_agent',
        question: 'Database connection string?',
        context: 'Setting up data layer',
        priority: 'high',
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      // Mock minimal enrichment for experienced user
      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        shouldAsk: true,
        confidence: 0.9,
        reasoning: 'Direct technical question',
        enrichedQuestion: {
          ...technicalQuestion,
          hash: 'db-connection-hash',
          contextualHelp: {
            explanation: 'Database connection configuration',
            whyAsked: 'Required for data persistence',
            howUsed: 'Application configuration',
            relatedConcepts: ['connection pooling'],
            documentationLinks: [],
          },
          examples: ['postgresql://user:pass@host:5432/db'],
          validationRules: ['Must be valid connection string format'],
          dependencies: [],
          relatedQuestions: [],
          followUpActions: [],
        },
      });

      const processResult = await SmartQuestionManager.processQuestion(
        mockChatId,
        technicalQuestion,
        mockModelId,
        mockDataStream,
        {
          enableDeduplication: true,
          enableEnrichment: true,
          confidenceThreshold: 0.8,
          userLevel: 'expert',
        },
      );

      expect(processResult.shouldAsk).toBe(true);
      expect(processResult.processedQuestion?.contextualHelp?.explanation).toBe(
        'Database connection configuration',
      );
      expect(processResult.processedQuestion?.examples?.[0]).toContain(
        'postgresql://',
      );

      // Step 4: User provides technical answer
      const technicalAnswer = {
        id: 'tech-answer-1',
        requestId: 'tech-q1',
        answer: 'postgresql://admin:secret@localhost:5432/myapp',
        timestamp: '2024-01-01T00:00:00.000Z',
        agentName: 'code_agent',
      };

      // Mock validation with technical feedback
      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        isValid: true,
        confidence: 0.98,
        feedback: 'Valid PostgreSQL connection string',
        suggestions: ['Consider using environment variables for credentials'],
        qualityScore: 0.95,
      });

      const validationResult = await SmartQuestionManager.validateAnswer(
        mockChatId,
        'tech-q1',
        technicalAnswer,
        mockModelId,
        mockDataStream,
      );

      expect(validationResult.isValid).toBe(true);
      expect(validationResult.suggestions?.[0]).toContain(
        'environment variables',
      );

      // Step 5: Test auto-advance behavior
      const actions = UserActionHandler.getAvailableActions(
        mockChatId,
        mockModelId,
      );
      const skipAction = actions.find((a) => a.type === 'skip');

      expect(skipAction?.enabled).toBe(true);

      // Execute skip action for optional steps
      const skipResult = await UserActionHandler.executeAction(
        mockChatId,
        skipAction!,
        mockModelId,
        mockDataStream,
      );

      expect(skipResult.success).toBe(true);
      expect(skipResult.actionType).toBe('skip');

      // Verify workflow advanced
      const finalState = EnhancedStateManager.getEnhancedState(mockChatId);
      const optionalStep = finalState.workflowSteps.find(
        (s) => s.id === 'optional-docs',
      );
      expect(optionalStep?.status).toBe('skipped');
    });
  });

  describe('Complete User Journey: Error Recovery Scenario', () => {
    it('should handle and recover from various error conditions', async () => {
      const { generateStructuredAnalysis } = await import(
        '@/lib/ai/enhanced-conversation-state/ai-sdk-integration'
      );

      // Step 1: Set up workflow with potential failure points
      EnhancedStateManager.updateEnhancedState(mockChatId, (state) => ({
        ...state,
        workflowPhase: 'implementation',
        currentAgent: 'code_agent',
        isWaitingForClarification: true,
        pendingClarifications: new Map([
          [
            'error-q1',
            {
              id: 'error-q1',
              agentName: 'code_agent',
              question: 'How to handle compilation error?',
              context: 'Build failed with syntax error',
              priority: 'critical',
              timestamp: '2024-01-01T00:00:00.000Z',
            },
          ],
        ]),
        workflowSteps: [
          {
            id: 'build',
            name: 'Build Process',
            status: 'failed',
            isOptional: false,
            error: 'Compilation failed: syntax error in main.ts',
          },
        ],
      }));

      // Step 2: User requests help
      const actions = UserActionHandler.getAvailableActions(
        mockChatId,
        mockModelId,
      );
      const helpAction = actions.find((a) => a.type === 'help');

      expect(helpAction?.enabled).toBe(true);

      // Mock contextual help generation
      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        helpSections: [
          {
            title: 'Current Issue',
            content: 'Build process failed due to syntax error',
            examples: ['Check main.ts for syntax issues', 'Review error logs'],
          },
          {
            title: 'Recovery Options',
            content: 'You can restart the build or modify the code',
            examples: ['Fix syntax error', 'Restart build process'],
          },
        ],
        quickActions: [
          'Restart build',
          'View error details',
          'Modify preferences',
        ],
        relatedTopics: ['Error handling', 'Build troubleshooting'],
      });

      const helpResult = await UserActionHandler.executeAction(
        mockChatId,
        helpAction!,
        mockModelId,
        mockDataStream,
      );

      expect(helpResult.success).toBe(true);
      expect(helpResult.nextSteps).toContain('Restart build');

      // Step 3: User decides to restart the workflow
      const restartAction = actions.find((a) => a.type === 'restart');
      expect(restartAction?.enabled).toBe(true);

      const restartResult = await UserActionHandler.executeAction(
        mockChatId,
        restartAction!,
        mockModelId,
        mockDataStream,
      );

      expect(restartResult.success).toBe(true);
      expect(restartResult.stateChanges).toContain(
        'Cleared pending clarifications',
      );

      // Step 4: Verify recovery state
      const recoveredState = EnhancedStateManager.getEnhancedState(mockChatId);
      expect(recoveredState.pendingClarifications.size).toBe(0);
      expect(recoveredState.isWaitingForClarification).toBe(false);

      // Step 5: Process new question after recovery
      const recoveryQuestion: ClarificationRequest = {
        id: 'recovery-q1',
        agentName: 'code_agent',
        question: 'Which TypeScript version should we use?',
        context: 'Rebuilding with correct configuration',
        priority: 'high',
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      // Mock successful processing after recovery
      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        shouldAsk: true,
        confidence: 0.9,
        reasoning: 'Post-recovery question processing',
        enrichedQuestion: {
          ...recoveryQuestion,
          hash: 'typescript-version-hash',
          contextualHelp: {
            explanation: 'TypeScript version affects available features',
            whyAsked: 'Ensures compatibility and stability',
            howUsed: 'Configures build tools and IDE support',
            relatedConcepts: ['ES modules', 'type checking'],
            documentationLinks: [],
          },
          examples: ['5.0.x (latest)', '4.9.x (stable)'],
        },
      });

      const recoveryResult = await SmartQuestionManager.processQuestion(
        mockChatId,
        recoveryQuestion,
        mockModelId,
        mockDataStream,
        {
          enableDeduplication: true,
          enableEnrichment: true,
          confidenceThreshold: 0.8,
          userLevel: 'intermediate',
        },
      );

      expect(recoveryResult.shouldAsk).toBe(true);
      expect(recoveryResult.processedQuestion?.examples).toContain(
        '5.0.x (latest)',
      );

      // Verify system is fully operational after recovery
      const finalState = EnhancedStateManager.getEnhancedState(mockChatId);
      expect(finalState.questionHistory.has('typescript-version-hash')).toBe(
        true,
      );
      expect(
        finalState.stateTransitionLog.some(
          (log) => log.type === 'workflow_restart',
        ),
      ).toBe(true);
    });
  });

  describe('Complete User Journey: Preference Learning and Adaptation', () => {
    it('should learn from user behavior and adapt preferences', async () => {
      const { generateStructuredAnalysis } = await import(
        '@/lib/ai/enhanced-conversation-state/ai-sdk-integration'
      );

      // Step 1: Start with default preferences
      let preferences = UserPreferenceManager.getUserPreferences(mockChatId);
      expect(preferences.autoAdvancePreference).toBe('ask');

      // Step 2: Simulate user consistently choosing to advance manually
      for (let i = 0; i < 3; i++) {
        EnhancedStateManager.updateEnhancedState(mockChatId, (state) => ({
          ...state,
          stateTransitionLog: [
            ...state.stateTransitionLog,
            {
              type: 'manual_advance',
              reason: 'user requested advance',
              timestamp: `2024-01-01T0${i}:00:00.000Z`,
              agentName: 'core_agent',
            },
          ],
        }));
      }

      // Step 3: Add some answered questions to build history
      EnhancedStateManager.updateEnhancedState(mockChatId, (state) => ({
        ...state,
        questionHistory: new Map([
          [
            'q1',
            {
              id: 'q1',
              question: 'Detailed question with comprehensive answer',
              answer: {
                answer:
                  'Very detailed response with lots of context and explanation that shows user prefers comprehensive information',
                providedAt: '2024-01-01T00:00:00.000Z',
              },
              agentName: 'core_agent',
              timestamp: '2024-01-01T00:00:00.000Z',
            },
          ],
          [
            'q2',
            {
              id: 'q2',
              question: 'Another comprehensive question',
              answer: {
                answer:
                  'Another detailed response showing consistent pattern of detailed answers',
                providedAt: '2024-01-01T01:00:00.000Z',
              },
              agentName: 'core_agent',
              timestamp: '2024-01-01T01:00:00.000Z',
            },
          ],
        ]),
        performanceMetrics: {
          averageResponseTime: 45000, // 45 seconds - user takes time to provide detailed answers
        },
      }));

      // Step 4: Get preference recommendations based on behavior
      const recommendations =
        UserPreferenceManager.getPreferenceRecommendations(mockChatId);

      expect(recommendations.recommendations.length).toBeGreaterThan(0);

      // Should recommend auto-advance based on manual advance pattern
      const autoAdvanceRec = recommendations.recommendations.find(
        (r) => r.preference === 'autoAdvancePreference',
      );
      expect(autoAdvanceRec?.recommendedValue).toBe('always');

      // Should recommend longer timeout based on response time
      const timeoutRec = recommendations.recommendations.find(
        (r) => r.preference === 'timeoutForAutoAdvance',
      );
      expect(timeoutRec?.recommendedValue).toBeGreaterThan(30);

      // Step 5: Apply recommendations
      if (autoAdvanceRec) {
        UserPreferenceManager.setPreference(
          mockChatId,
          'autoAdvancePreference',
          autoAdvanceRec.recommendedValue as any,
        );
      }

      if (timeoutRec) {
        UserPreferenceManager.setPreference(
          mockChatId,
          'timeoutForAutoAdvance',
          timeoutRec.recommendedValue as number,
        );
      }

      // Step 6: Verify preferences were updated
      const updatedPreferences =
        UserPreferenceManager.getUserPreferences(mockChatId);
      expect(updatedPreferences.autoAdvancePreference).toBe('always');
      expect(updatedPreferences.timeoutForAutoAdvance).toBeGreaterThan(30);

      // Step 7: Test that new preferences affect behavior
      const actions = UserActionHandler.getAvailableActions(
        mockChatId,
        mockModelId,
      );
      const continueAction = actions.find((a) => a.type === 'continue');

      // Should be enabled due to auto-advance preference
      expect(continueAction?.enabled).toBe(true);

      // Step 8: Export preferences for backup/sharing
      const exported = UserPreferenceManager.exportPreferences(mockChatId);
      expect(exported.preferences.autoAdvancePreference).toBe('always');
      expect(exported.metadata.hasCustomizations).toBe(true);

      // Step 9: Test import to new session
      const newChatId = 'adapted-preferences-chat';
      const imported = UserPreferenceManager.importPreferences(
        newChatId,
        exported,
      );

      expect(imported.autoAdvancePreference).toBe('always');
      expect(imported.timeoutForAutoAdvance).toBeGreaterThan(30);
    });
  });

  describe('Complete User Journey: Multi-Agent Workflow Coordination', () => {
    it('should coordinate complex multi-agent workflow with user interactions', async () => {
      const { generateStructuredAnalysis } = await import(
        '@/lib/ai/enhanced-conversation-state/ai-sdk-integration'
      );

      // Step 1: Initialize complex workflow
      const workflowConfig = {
        phases: [
          {
            id: 'planning',
            name: 'Planning Phase',
            agents: ['core_agent'],
            requiredInputs: ['requirements', 'constraints'],
          },
          {
            id: 'design',
            name: 'Design Phase',
            agents: ['architecture_agent', 'diagram_agent'],
            requiredInputs: ['architecture_decisions'],
          },
          {
            id: 'implementation',
            name: 'Implementation Phase',
            agents: ['code_agent', 'test_agent'],
            requiredInputs: ['implementation_plan'],
          },
        ],
      };

      EnhancedStateManager.updateEnhancedState(mockChatId, (state) => ({
        ...state,
        workflowPhase: 'planning',
        currentAgent: 'core_agent',
        workflowConfig,
        agentCapabilities: new Map([
          ['core_agent', ['planning', 'coordination']],
          ['architecture_agent', ['system_design', 'patterns']],
          ['diagram_agent', ['visualization', 'documentation']],
          ['code_agent', ['code_generation', 'refactoring']],
          ['test_agent', ['test_generation', 'validation']],
        ]),
        workflowSteps: [
          {
            id: 'requirements',
            name: 'Gather Requirements',
            status: 'active',
            isOptional: false,
            agent: 'core_agent',
          },
          {
            id: 'constraints',
            name: 'Define Constraints',
            status: 'pending',
            isOptional: false,
            agent: 'core_agent',
          },
        ],
      }));

      // Step 2: Core agent asks for requirements
      const requirementsQuestion: ClarificationRequest = {
        id: 'req-q1',
        agentName: 'core_agent',
        question: 'What are the main functional requirements?',
        context: 'Planning phase - requirements gathering',
        priority: 'critical',
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        shouldAsk: true,
        confidence: 0.95,
        reasoning: 'Critical planning question',
        enrichedQuestion: {
          ...requirementsQuestion,
          hash: 'requirements-hash',
          contextualHelp: {
            explanation:
              'Functional requirements define what the system should do',
            whyAsked: 'Foundation for all subsequent design and implementation',
            howUsed: 'Guides architecture decisions and feature prioritization',
            relatedConcepts: ['user stories', 'acceptance criteria'],
            documentationLinks: [],
          },
          examples: ['User authentication', 'Data processing', 'API endpoints'],
        },
      });

      const reqResult = await SmartQuestionManager.processQuestion(
        mockChatId,
        requirementsQuestion,
        mockModelId,
        mockDataStream,
        {
          enableDeduplication: true,
          enableEnrichment: true,
          confidenceThreshold: 0.8,
          userLevel: 'intermediate',
        },
      );

      expect(reqResult.shouldAsk).toBe(true);

      // Step 3: User provides requirements
      const reqAnswer = {
        id: 'req-answer-1',
        requestId: 'req-q1',
        answer:
          'User authentication, data processing pipeline, REST API, real-time notifications',
        timestamp: '2024-01-01T00:00:00.000Z',
        agentName: 'core_agent',
      };

      // Step 4: Transition to next agent (architecture_agent)
      const nextAgent = await WorkflowOrchestrator.determineNextAgent(
        mockChatId,
        'core_agent',
        'requirements_complete',
      );

      expect(nextAgent).toBe('architecture_agent');

      // Step 5: Architecture agent asks design question
      const designQuestion: ClarificationRequest = {
        id: 'design-q1',
        agentName: 'architecture_agent',
        question: 'Should we use microservices or monolithic architecture?',
        context: 'System architecture design based on requirements',
        priority: 'high',
        timestamp: '2024-01-01T01:00:00.000Z',
      };

      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        shouldAsk: true,
        confidence: 0.9,
        reasoning: 'Architecture decision needed',
        enrichedQuestion: {
          ...designQuestion,
          hash: 'architecture-hash',
          contextualHelp: {
            explanation:
              'Architecture choice affects scalability and complexity',
            whyAsked: 'Determines system structure and deployment strategy',
            howUsed: 'Guides component design and technology choices',
            relatedConcepts: ['scalability', 'maintainability', 'deployment'],
            documentationLinks: [],
          },
          examples: [
            'Microservices for scalability',
            'Monolith for simplicity',
          ],
        },
      });

      const designResult = await SmartQuestionManager.processQuestion(
        mockChatId,
        designQuestion,
        mockModelId,
        mockDataStream,
        {
          enableDeduplication: true,
          enableEnrichment: true,
          confidenceThreshold: 0.8,
          userLevel: 'intermediate',
        },
      );

      expect(designResult.shouldAsk).toBe(true);

      // Step 6: User chooses architecture
      const archAnswer = {
        id: 'arch-answer-1',
        requestId: 'design-q1',
        answer: 'Microservices architecture for better scalability',
        timestamp: '2024-01-01T01:00:00.000Z',
        agentName: 'architecture_agent',
      };

      // Step 7: Continue workflow to implementation phase
      const implAgent = await WorkflowOrchestrator.determineNextAgent(
        mockChatId,
        'architecture_agent',
        'design_complete',
      );

      expect(implAgent).toBe('code_agent');

      // Step 8: Verify complete workflow state
      const finalState = EnhancedStateManager.getEnhancedState(mockChatId);
      expect(finalState.questionHistory.has('requirements-hash')).toBe(true);
      expect(finalState.questionHistory.has('architecture-hash')).toBe(true);
      expect(finalState.stateTransitionLog.length).toBeGreaterThan(0);
      expect(
        finalState.stateTransitionLog.some(
          (log) => log.type === 'agent_transition',
        ),
      ).toBe(true);

      // Step 9: Test user can modify workflow mid-process
      const actions = UserActionHandler.getAvailableActions(
        mockChatId,
        mockModelId,
      );
      const modifyAction = actions.find((a) => a.type === 'modify');

      expect(modifyAction?.enabled).toBe(true);

      const modifyResult = await UserActionHandler.executeAction(
        mockChatId,
        modifyAction!,
        mockModelId,
        mockDataStream,
      );

      expect(modifyResult.success).toBe(true);
      expect(modifyResult.nextSteps).toContain('Modify: User preferences');
    });
  });
});
