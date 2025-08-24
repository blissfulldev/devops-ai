# Enhanced HITL System Types

This directory contains comprehensive type definitions for the Enhanced Human-in-the-Loop (HITL) system. The types are organized into several files for better maintainability and to avoid circular dependencies.

## File Structure

### `../types.ts` (Main Types File)

Contains the core types that are used throughout the application:

- `ClarificationRequest` - Enhanced with AI-powered fields
- `ClarificationResponse` - Extended with validation and feedback data
- `CustomUIDataTypes` - Comprehensive UI data streaming types
- Utility types and configuration interfaces

### `ui.ts` (UI-Specific Types)

Contains types specifically designed for React components and UI interactions:

- Component state types (`ClarificationUIState`, `WorkflowUIState`)
- Event handler interfaces (`ClarificationHandlers`, `WorkflowHandlers`)
- UI component props (`ClarificationModalProps`, `ValidationModalProps`)
- Form data types and user feedback interfaces
- Theme, accessibility, and responsive design types

### `enhanced-hitl.ts` (System-Level Types)

Contains comprehensive system-level types for the complete HITL system:

- System configuration (`HITLSystemConfig`)
- Health monitoring (`HITLSystemStatus`)
- Analytics and reporting (`HITLAnalytics`)
- Event system types (`HITLEvent`, `HITLEventType`)
- Plugin system interfaces
- Testing and debugging types

### `index.ts` (Main Export File)

Provides convenient access to all types with:

- Re-exports from all type files
- Type guards for runtime validation
- Utility functions for type creation
- Default configurations and constants

## Key Enhancements

### Enhanced ClarificationRequest

The `ClarificationRequest` interface has been significantly enhanced with:

```typescript
interface ClarificationRequest {
  // Core fields
  id: string;
  agentName: string;
  question: string;
  context: string;
  options?: string[];
  priority: "low" | "medium" | "high";
  timestamp: string;

  // Enhanced HITL fields
  questionHash?: string; // For deduplication
  enrichedContext?: string; // AI-generated context
  examples?: string[]; // Helpful examples
  relatedConcepts?: string[]; // Related concepts
  validationRules?: ValidationRule[]; // Validation rules
  contextualHelp?: ContextualHelp; // Detailed help
  dependencies?: string[]; // Question dependencies
  followUpActions?: string[]; // Suggested actions
  estimatedAnswerTime?: number; // Time estimate
  difficultyLevel?: "easy" | "medium" | "hard"; // Difficulty
}
```

### Enhanced ClarificationResponse

The `ClarificationResponse` interface now includes:

```typescript
interface ClarificationResponse {
  // Core fields
  id: string;
  requestId: string;
  answer: string;
  selectedOption?: string;
  timestamp: string;
  agentName?: string;

  // Enhanced HITL fields
  validationResult?: AnswerValidation; // AI validation
  isValid?: boolean; // Validation status
  confidence?: number; // Confidence score
  processingTime?: number; // Processing time
  wasReused?: boolean; // Reuse indicator
  followUpQuestions?: ClarificationRequest[]; // Follow-ups
  userFeedback?: UserFeedback; // User feedback
}
```

### Comprehensive UI Data Types

The `CustomUIDataTypes` now includes over 20 different data types for streaming to the UI:

- **Question Management**: `answerReuse`, `questionEnrichment`
- **Validation**: `validationResult`, `clarificationFeedback`
- **Workflow**: `workflowGuidance`, `progressUpdate`, `phaseExplanation`
- **User Actions**: `userActionRequest`, `userActionResult`
- **Error Handling**: `hitlError`, `errorRecovery`
- **System Status**: `systemStatus`, `performanceMetrics`
- **Notifications**: `notification`, `liveUpdate`

## Usage Examples

### Type Guards

```typescript
import { isValidClarificationRequest } from "@/lib/types";

if (isValidClarificationRequest(data)) {
  // TypeScript knows data is ClarificationRequest
  console.log(data.question);
}
```

### Default Configurations

```typescript
import { DEFAULT_HITL_CONFIG, DEFAULT_DISPLAY_OPTIONS } from "@/lib/types";

const config = {
  ...DEFAULT_HITL_CONFIG,
  confidenceThreshold: 0.9, // Override specific values
};
```

### UI Component Props

```typescript
import type { ClarificationModalProps } from "@/lib/types";

const ClarificationModal: React.FC<ClarificationModalProps> = ({
  isOpen,
  request,
  onClose,
  onSubmit,
  options,
}) => {
  // Component implementation
};
```

### Event Handling

```typescript
import type { ClarificationHandlers } from "@/lib/types";

const handlers: ClarificationHandlers = {
  onSubmitAnswer: async (requestId, answer) => {
    // Handle answer submission
  },
  onRequestHelp: async (requestId, helpType) => {
    // Handle help request
  },
  // ... other handlers
};
```

## Type Safety Benefits

1. **Compile-time Validation**: Catch type errors during development
2. **IntelliSense Support**: Better IDE autocomplete and documentation
3. **Refactoring Safety**: Ensure changes don't break existing code
4. **API Consistency**: Maintain consistent interfaces across components
5. **Documentation**: Types serve as living documentation

## Best Practices

1. **Use Type Guards**: Validate data at runtime boundaries
2. **Leverage Utility Types**: Use provided utility functions for type creation
3. **Import Selectively**: Import only the types you need to reduce bundle size
4. **Extend Carefully**: When extending interfaces, maintain backward compatibility
5. **Document Changes**: Update this README when adding new types

## Migration Guide

When upgrading from basic clarification types to enhanced types:

1. Update import statements to use the new type locations
2. Add optional enhanced fields gradually
3. Use type guards to validate enhanced data
4. Update UI components to handle new data types
5. Test thoroughly with both old and new data formats

## Future Enhancements

- **Internationalization**: Add support for multi-language types
- **Accessibility**: Enhance accessibility-related type definitions
- **Performance**: Add performance monitoring type definitions
- **Security**: Add security-related type definitions for input validation
- **Analytics**: Expand analytics types for better insights
