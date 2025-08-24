# Enhanced HITL System Testing Suite

This directory contains comprehensive tests for the Enhanced Human-in-the-Loop (HITL) system, covering unit tests, integration tests, and end-to-end scenarios.

## Test Structure

```
tests/
├── unit/                          # Unit tests for individual components
│   └── enhanced-hitl/
│       ├── smart-question-manager.test.ts
│       ├── user-preference-manager.test.ts
│       └── user-action-handler.test.ts
├── integration/                   # Integration tests for component interactions
│   └── enhanced-hitl-integration.test.ts
├── e2e/                          # End-to-end user journey tests
│   ├── enhanced-hitl-e2e.test.ts
│   ├── enhanced-clarification.test.ts
│   └── user-actions.test.ts
├── setup.ts                      # Global test setup and utilities
└── README.md                     # This file
```

## Test Categories

### Unit Tests

**Location**: `tests/unit/enhanced-hitl/`

These tests focus on individual components in isolation:

- **SmartQuestionManager**: Tests question processing, deduplication, enrichment, validation, and follow-up generation
- **UserPreferenceManager**: Tests preference management, validation, recommendations, and import/export
- **UserActionHandler**: Tests action execution, validation, and state management

**Key Features Tested**:

- Question processing with AI enrichment
- Answer validation and feedback
- User preference management and adaptation
- Action execution and workflow control
- Error handling and fallback mechanisms
- Configuration validation and sanitization

### Integration Tests

**Location**: `tests/integration/`

These tests verify that components work together correctly:

- **Enhanced HITL Integration**: Tests complete question lifecycle, preference integration, workflow coordination, and performance under load
- **State Management**: Tests state consistency across multiple components
- **AI Service Integration**: Tests interaction with AI services and fallback behavior

**Key Scenarios Tested**:

- Complete question processing flow (process → validate → follow-up)
- Question deduplication across multiple agents
- User preference adaptation based on behavior
- Multi-agent workflow coordination
- Error recovery and state consistency
- Performance and scalability under concurrent load

### End-to-End Tests

**Location**: `tests/e2e/`

These tests simulate complete user journeys:

- **New User Onboarding**: First-time user experience with default preferences
- **Experienced User Workflow**: Advanced user with custom preferences and auto-advance
- **Error Recovery Scenarios**: System recovery from various failure conditions
- **Preference Learning**: System adaptation based on user behavior patterns
- **Multi-Agent Coordination**: Complex workflows involving multiple agents

**User Journeys Covered**:

1. New user with guided experience and contextual help
2. Expert user with minimal verbosity and auto-advance
3. Error recovery with help system and workflow restart
4. Preference learning and recommendation system
5. Multi-phase workflow with agent transitions

## Test Utilities

### Global Test Utilities

The `tests/setup.ts` file provides global utilities available in all tests:

```typescript
// Mock data stream for testing UI interactions
const mockStream = global.testUtils.createMockDataStream();

// Create mock clarification requests
const mockRequest = global.testUtils.createMockClarificationRequest({
  question: "Custom question?",
  priority: "high",
});

// Create mock user responses
const mockResponse = global.testUtils.createMockUserResponse({
  answer: "Custom answer",
});

// Create mock user actions
const mockAction = global.testUtils.createMockUserAction({
  type: "skip",
  enabled: true,
});

// Async utilities
await global.testUtils.waitFor(1000); // Wait 1 second
await global.testUtils.expectEventuallyTrue(() => condition, 5000); // Wait for condition
```

### Mock Configuration

All external dependencies are mocked:

- AI SDK integration (`generateStructuredAnalysis`, `streamToUI`)
- Conversation state management
- External APIs and services

## Running Tests

### Prerequisites

Ensure you have the required dependencies:

```bash
npm install vitest @vitest/ui @vitest/coverage-v8 --save-dev
```

### Test Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test categories
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run test:e2e         # End-to-end tests only

# Run tests with UI
npm run test:ui

# Run specific test file
npx vitest tests/unit/enhanced-hitl/smart-question-manager.test.ts
```

### Coverage Requirements

The test suite maintains high coverage standards:

- **Branches**: 80% minimum
- **Functions**: 80% minimum
- **Lines**: 80% minimum
- **Statements**: 80% minimum

Coverage reports are generated in:

- Text format (console output)
- HTML format (`coverage/index.html`)
- JSON format (`coverage/coverage.json`)

## Test Data and Scenarios

### Mock Data Patterns

Tests use consistent mock data patterns:

```typescript
// Standard chat ID for tests
const mockChatId = "test-chat-123";

// Standard model ID
const mockModelId = "gpt-4";

// Standard timestamps
const mockTimestamp = "2024-01-01T00:00:00.000Z";

// Standard user preferences
const mockPreferences = {
  autoAdvancePreference: "ask",
  verbosityLevel: "normal",
  skipOptionalSteps: false,
  preferredQuestionFormat: "mixed",
  timeoutForAutoAdvance: 30,
};
```

### Test Scenarios

#### Question Processing Scenarios

- New questions requiring enrichment
- Similar questions triggering deduplication
- Invalid questions requiring fallback
- Questions with validation rules
- Questions generating follow-ups

#### User Preference Scenarios

- Default preferences for new users
- Custom preferences for experienced users
- Invalid preference validation
- Preference recommendations based on behavior
- Import/export of preference configurations

#### Workflow Scenarios

- Single-agent workflows
- Multi-agent coordination
- Workflow phase transitions
- Error conditions and recovery
- Optional step handling

#### Error Handling Scenarios

- AI service failures
- State corruption
- Network timeouts
- Invalid user inputs
- System resource constraints

## Best Practices

### Test Organization

- Group related tests using `describe` blocks
- Use descriptive test names that explain the scenario
- Follow the Arrange-Act-Assert pattern
- Keep tests focused on single behaviors

### Mock Management

- Clear mocks between tests using `beforeEach`
- Restore mocks after tests using `afterEach`
- Use specific mock implementations for each test scenario
- Avoid over-mocking - test real interactions where possible

### Async Testing

- Always await async operations
- Use proper timeout values for different scenarios
- Test both success and failure paths
- Handle promise rejections appropriately

### State Management

- Reset state between tests
- Test state transitions explicitly
- Verify state consistency after operations
- Test concurrent state modifications

## Debugging Tests

### Common Issues

1. **Mock not working**: Ensure mocks are set up before the test runs
2. **Async timing**: Use proper awaits and timeouts
3. **State pollution**: Clear state between tests
4. **Import errors**: Check path aliases and module resolution

### Debugging Tools

```bash
# Run single test with debug output
npx vitest --reporter=verbose tests/path/to/test.ts

# Run tests with Node.js debugging
node --inspect-brk ./node_modules/.bin/vitest

# Use VS Code debugging with breakpoints
# Configure launch.json for Vitest debugging
```

### Test Output

Tests provide detailed output including:

- Test execution time
- Coverage metrics
- Failed assertion details
- Mock call verification
- State transition logs

## Contributing

When adding new tests:

1. Follow the existing test structure and naming conventions
2. Add tests for both success and failure scenarios
3. Include edge cases and boundary conditions
4. Update this README if adding new test categories
5. Ensure tests pass in CI/CD environment
6. Maintain or improve coverage metrics

### Test Checklist

- [ ] Unit tests for new components
- [ ] Integration tests for component interactions
- [ ] E2E tests for user-facing features
- [ ] Error handling and edge cases
- [ ] Performance and scalability considerations
- [ ] Documentation updates
- [ ] Coverage requirements met
