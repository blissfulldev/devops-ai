import { vi } from 'vitest';

// Global test setup
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  // Restore all mocks after each test
  vi.restoreAllMocks();
});

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock environment variables
process.env.NODE_ENV = 'test';

// Global test utilities
global.testUtils = {
  createMockDataStream: () => ({
    write: vi.fn(),
    end: vi.fn(),
  }),

  createMockClarificationRequest: (overrides = {}) => ({
    id: 'test-request-123',
    agentName: 'core_agent',
    question: 'Test question?',
    context: 'Test context',
    priority: 'medium',
    timestamp: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }),

  createMockUserResponse: (overrides = {}) => ({
    id: 'test-response-123',
    requestId: 'test-request-123',
    answer: 'Test answer',
    timestamp: '2024-01-01T00:00:00.000Z',
    agentName: 'core_agent',
    ...overrides,
  }),

  createMockUserAction: (overrides = {}) => ({
    id: 'test-action-123',
    label: 'Test Action',
    description: 'Test action description',
    type: 'continue',
    enabled: true,
    ...overrides,
  }),

  waitFor: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),

  expectEventuallyTrue: async (condition: () => boolean, timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (condition()) {
        return;
      }
      await global.testUtils.waitFor(100);
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  },
};

// Extend global types
declare global {
  var testUtils: {
    createMockDataStream: () => any;
    createMockClarificationRequest: (overrides?: any) => any;
    createMockUserResponse: (overrides?: any) => any;
    createMockUserAction: (overrides?: any) => any;
    waitFor: (ms: number) => Promise<void>;
    expectEventuallyTrue: (
      condition: () => boolean,
      timeout?: number,
    ) => Promise<void>;
  };
}
