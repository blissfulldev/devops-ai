import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartQuestionManager } from '@/lib/ai/enhanced-conversation-state/smart-question-manager';
import { UserPreferenceManager } from '@/lib/ai/enhanced-conversation-state/user-preference-manager';
import { UserActionHandler } from '@/lib/ai/enhanced-conversation-state/user-action-handler';
import { WorkflowOrchestrator } from '@/lib/ai/enhanced-conversation-state/workflow-orchestrator';
import { EnhancedStateManager } from '@/lib/ai/enhanced-conversation-state/enhanced-state-manager';
import type { ClarificationRequest, UserAction } from '@/lib/types';

// Mock external dependencies
vi.mock('@/lib/ai/enhanced-conversation-state/ai-sdk-integration', () => ({
  generateStructuredAnalysis: vi.fn(),
  streamToUI: vi.fn(),
}));

vi.mock('@/lib/ai/conversation-state', () => ({
  getConversationState: vi.fn(),
  updateConversationState: vi.fn(),
}));

describe('Enhanced HITL System Integration', () => {
  const mockChatId = 'integration-test-chat';
  const mockModelId = 'gpt-4';
  const mockDataStream = {
    write: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset state manager
    EnhancedStateManager.clearState(mockChatId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('End-to-End Question Processing Flow', () => {
    it('should process a complete question lifecycle', async () => {
      const { generateStructuredAnalysis } = await import(
        '@/lib/ai/enhanced-conversation-state/ai-sdk-integration'
      );

      // Mock AI responses for the complete flow
      (generateStructuredAnalysis as any)
        .mockResolvedValueOnce({
          // Initial question processing
          shouldAsk: true,
          confidence: 0.9,
          reasoning: 'New question requiring user input',
          enrichedQuestion: {
            id: 'test-question-1',
            agentName: 'core_agent',
            question: 'What AWS region should we use?',
            context: 'Deployment configuration',
            priority: 'high',
            timestamp: '2024-01-01T00:00:00.000Z',
            hash: 'question-hash-123',
            contextualHelp: {
              explanation: 'AWS regions affect latency and compliance',
              whyAsked: 'Regional selection is crucial for performance',
              howUsed: 'Used to configure all AWS resources',
              relatedConcepts: ['latency', 'compliance'],
              documentationLinks: [],
            },
            examples: ['us-east-1', 'eu-west-1'],
            validationRules: [],
            dependencies: [],
            relatedQuestions: [],
            followUpActions: [],
          },
        })
        .mockResolvedValueOnce({
          // Answer validation
          isValid: true,
          confidence: 0.95,
          feedback: 'Valid AWS region selection',
          suggestions: [],
          qualityScore: 0.9,
        })
        .mockResolvedValueOnce({
          // Follow-up generation
          followUpQuestions: [
            {
              id: 'followup-1',
              question: 'Do you need multi-region deployment?',
              context: 'Based on your region selection',
              priority: 'medium',
              agentName: 'core_agent',
              timestamp: '2024-01-01T00:00:00.000Z',
            },
          ],
          reasoning: 'Generated follow-up based on region selection',
        });

      // Step 1: Process initial question
      const clarificationRequest: ClarificationRequest = {
        id: 'test-question-1',
        agentName: 'core_agent',
        question: 'What AWS region should we use?',
        context: 'Deployment configuration',
        priority: 'high',
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      const processResult = await SmartQuestionManager.processQuestion(
        mockChatId,
        clarificationRequest,
        mockModelId,
        mockDataStream,
        {
          enableDeduplication: true,
          enableEnrichment: true,
          confidenceThreshold: 0.8,
          userLevel: 'intermediate',
        },
      );

      expect(processResult.shouldAsk).toBe(true);
      expect(processResult.processedQuestion?.contextualHelp).toBeDefined();

      // Step 2: Simulate user response
      const userResponse = {
        id: 'response-1',
        requestId: 'test-question-1',
        answer: 'us-east-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        agentName: 'core_agent',
      };

      // Step 3: Validate answer
      const validationResult = await SmartQuestionManager.validateAnswer(
        mockChatId,
        'test-question-1',
        userResponse,
        mockModelId,
        mockDataStream,
      );

      expect(validationResult.isValid).toBe(true);
      expect(validationResult.confidence).toBe(0.95);

      // Step 4: Generate follow-up questions
      const followUpQuestions =
        await SmartQuestionManager.generateFollowUpQuestions(
          mockChatId,
          'test-question-1',
          mockModelId,
        );

      expect(followUpQuestions).toHaveLength(1);
      expect(followUpQuestions[0].question).toContain('multi-region');

      // Verify state was updated throughout the process
      const finalState = EnhancedStateManager.getEnhancedState(mockChatId);
      expect(finalState.questionHistory.has('question-hash-123')).toBe(true);
    });

    it('should handle question deduplication correctly', async () => {
      const { generateStructuredAnalysis } = await import(
        '@/lib/ai/enhanced-conversation-state/ai-sdk-integration'
      );

      // First question
      const firstQuestion: ClarificationRequest = {
        id: 'question-1',
        agentName: 'core_agent',
        question: 'What AWS region should we use?',
        context: 'Initial deployment',
        priority: 'high',
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      // Mock first question processing
      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        shouldAsk: true,
        confidence: 0.9,
        reasoning: 'New question',
        enrichedQuestion: {
          ...firstQuestion,
          hash: 'region-question-hash',
        },
      });

      // Process first question
      const firstResult = await SmartQuestionManager.processQuestion(
        mockChatId,
        firstQuestion,
        mockModelId,
        mockDataStream,
        {
          enableDeduplication: true,
          enableEnrichment: true,
          confidenceThreshold: 0.8,
          userLevel: 'intermediate',
        },
      );

      expect(firstResult.shouldAsk).toBe(true);

      // Simulate answering the first question
      const userResponse = {
        id: 'response-1',
        requestId: 'question-1',
        answer: 'us-east-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        agentName: 'core_agent',
      };

      // Update state with the answer
      EnhancedStateManager.updateEnhancedState(mockChatId, (state) => {
        const questionEntry = state.questionHistory.get('region-question-hash');
        if (questionEntry) {
          questionEntry.answer = userResponse;
        }
        return state;
      });

      // Second similar question
      const similarQuestion: ClarificationRequest = {
        id: 'question-2',
        agentName: 'diagram_agent',
        question: 'Which AWS region do you prefer?',
        context: 'Diagram generation',
        priority: 'medium',
        timestamp: '2024-01-01T01:00:00.000Z',
      };

      // Mock similarity detection
      (generateStructuredAnalysis as any).mockResolvedValueOnce({
        shouldAsk: false,
        confidence: 0.85,
        reasoning:
          'Question is similar to a previous one (confidence: 85%). Reusing previous answer.',
        reusedAnswer: userResponse,
        similarQuestionId: 'question-1',
      });

      // Process similar question
      const secondResult = await SmartQuestionManager.processQuestion(
        mockChatId,
        similarQuestion,
        mockModelId,
        mockDataStream,
        {
          enableDeduplication: true,
          enableEnrichment: true,
          confidenceThreshold: 0.8,
          userLevel: 'intermediate',
        },
      );

      expect(secondResult.shouldAsk).toBe(false);
      expect(secondResult.reusedAnswer).toEqual(userResponse);
      expect(secondResult.reasoning).toContain('similar');
    });
  });

  describe('User Preference Integration', () => {
    it('should adapt question processing based on user preferences', async () => {
      const { generateStructuredAnalysis } = await import(
        '@/lib/ai/enhanced-conversation-state/ai-sdk-integration'
      );

      // Set user preferences for detailed verbosity
      UserPreferenceManager.setUserPreferences(mockChatId, {
        verbosityLevel: 'detailed',
        preferredQuestionFormat: 'multiple_choice',
      });

      // Mock AI response with detailed enrichment
      (generateStructuredAnalysis as any).mockResolvedValue({
        shouldAsk: true,
        confidence: 0.9,
        reasoning: 'New question with detailed enrichment for advanced user',
        enrichedQuestion: {
          id: 'detailed-question',
          agentName: 'core_agent',
          question: 'What AWS region should we use?',
          context: 'Deployment configuration',
          priority: 'high',
          timestamp: '2024-01-01T00:00:00.000Z',
          hash: 'detailed-hash',
          contextualHelp: {
            explanation:
              'Comprehensive explanation of AWS regions and their implications',
            whyAsked:
              'Regional selection affects latency, compliance, and cost',
            howUsed:
              'This will configure all AWS resources in your infrastructure',
            relatedConcepts: [
              'latency',
              'compliance',
              'data sovereignty',
              'cost optimization',
            ],
            documentationLinks: ['https://docs.aws.amazon.com/regions'],
          },
          examples: [
            'us-east-1 (N. Virginia) - Lowest cost, highest availability',
            'eu-west-1 (Ireland) - GDPR compliant, good for European users',
          ],
        },
      });

      const clarificationRequest: ClarificationRequest = {
        id: 'detailed-question',
        agentName: 'core_agent',
        question: 'What AWS region should we use?',
        context: 'Deployment configuration',
        priority: 'high',
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      const result = await SmartQuestionManager.processQuestion(
        mockChatId,
        clarificationRequest,
        mockModelId,
        mockDataStream,
        {
          enableDeduplication: true,
          enableEnrichment: true,
          confidenceThreshold: 0.8,
          userLevel: 'advanced', // Advanced user level
        },
      );

      expect(result.processedQuestion?.contextualHelp?.explanation).toContain(
        'Comprehensive',
      );
      expect(
        result.processedQuestion?.contextualHelp?.relatedConcepts,
      ).toContain('data sovereignty');
      expect(result.processedQuestion?.examples?.[0]).toContain('Lowest cost');
    });

    it('should respect auto-advance preferences', async () => {
      // Set auto-advance preference
      UserPreferenceManager.setUserPreferences(mockChatId, {
        autoAdvancePreference: 'always',
        timeoutForAutoAdvance: 60,
      });

      // Initialize workflow state
      EnhancedStateManager.updateEnhancedState(mockChatId, (state) => ({
        ...state,
        workflowPhase: 'planning',
        currentAgent: 'core_agent',
        workflowSteps: [
          {
            id: 'step-1',
            name: 'Planning',
            status: 'completed',
            isOptional: false,
          },
          {
            id: 'step-2',
            name: 'Implementation',
            status: 'pending',
            isOptional: false,
          },
        ],
      }));

      // Get available actions
      const actions = UserActionHandler.getAvailableActions(
        mockChatId,
        mockModelId,
      );
      const continueAction = actions.find((a) => a.type === 'continue');

      expect(continueAction?.enabled).toBe(true);

      // Execute continue action
      const result = await UserActionHandler.executeAction(
        mockChatId,
        continueAction!,
        mockModelId,
        mockDataStream,
      );

      expect(result.success).toBe(true);
      expect(result.actionType).toBe('continue');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle multiple concurrent questions efficiently', async () => {
      const { generateStructuredAnalysis } = await import(
        '@/lib/ai/enhanced-conversation-state/ai-sdk-integration'
      );

      // Mock AI responses for concurrent processing
      (generateStructuredAnalysis as any).mockResolvedValue({
        shouldAsk: true,
        confidence: 0.9,
        reasoning: 'Concurrent question processing',
        enrichedQuestion: {
          id: 'concurrent-question',
          agentName: 'test_agent',
          question: 'Test question',
          context: 'Concurrent test',
          priority: 'medium',
          timestamp: '2024-01-01T00:00:00.000Z',
          hash: 'concurrent-hash',
        },
      });

      // Create multiple concurrent questions
      const questions = Array.from({ length: 5 }, (_, i) => ({
        id: `concurrent-${i}`,
        agentName: 'test_agent',
        question: `Test question ${i}`,
        context: 'Concurrent processing test',
        priority: 'medium' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
      }));

      // Process all questions concurrently
      const startTime = Date.now();
      const results = await Promise.all(
        questions.map((q) =>
          SmartQuestionManager.processQuestion(
            mockChatId,
            q,
            mockModelId,
            mockDataStream,
            {
              enableDeduplication: true,
              enableEnrichment: true,
              confidenceThreshold: 0.8,
              userLevel: 'intermediate',
            },
          ),
        ),
      );
      const endTime = Date.now();

      // Verify all questions were processed
      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result.shouldAsk).toBe(true);
      });

      // Verify reasonable performance (should complete within 5 seconds)
      expect(endTime - startTime).toBeLessThan(5000);

      // Verify state consistency
      const finalState = EnhancedStateManager.getEnhancedState(mockChatId);
      expect(finalState.questionHistory.size).toBeGreaterThan(0);
    });
  });
});
