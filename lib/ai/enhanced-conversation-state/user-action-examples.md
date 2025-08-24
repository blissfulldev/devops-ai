# User Action Handling Examples

This document provides examples of how to use the UserActionHandler system in the enhanced HITL workflow.

## Basic Usage

### 1. Getting Available Actions

```typescript
import { UserActionHandler } from "./user-action-handler";

// Get available actions for current workflow state
const availableActions = UserActionHandler.getAvailableActions(chatId, modelId);

console.log("Available actions:", availableActions);
// Output: [
//   {
//     id: 'continue-workflow',
//     label: 'Continue',
//     description: 'Resume workflow execution',
//     type: 'continue',
//     enabled: true,
//     riskLevel: 'low'
//   },
//   // ... more actions
// ]
```

### 2. Executing Actions

```typescript
import { UserActionHandler } from "./user-action-handler";

// Execute a continue action
const continueAction = {
  id: "continue-workflow",
  label: "Continue",
  description: "Resume workflow execution",
  type: "continue" as const,
  enabled: true,
};

const result = await UserActionHandler.executeAction(
  chatId,
  continueAction,
  modelId,
  dataStream,
  {
    confirmConsequences: true,
    dryRun: false,
  }
);

console.log("Action result:", result);
// Output: {
//   success: true,
//   actionId: 'continue-workflow',
//   actionType: 'continue',
//   message: 'Workflow continued successfully',
//   stateChanges: ['Resumed workflow execution'],
//   nextSteps: ['Execute core_agent'],
//   canUndo: true
// }
```

### 3. Using AI Tools

```typescript
import { createUserActionTools } from "./user-action-handler";

// Create AI tools for agents
const userActionTools = createUserActionTools(chatId, dataStream, modelId);

// Use in an agent
const agentTools = {
  ...otherTools,
  ...userActionTools,
};

// Agent can now call:
// - executeUserAction
// - getAvailableActions
```

## Action Types and Examples

### Continue Action

Resumes workflow execution when paused for clarifications or user input.

```typescript
const continueAction = {
  id: "continue-workflow",
  label: "Continue",
  description: "Resume workflow execution",
  type: "continue",
  enabled: true,
};

// Execution will:
// 1. Check if clarifications are answered
// 2. Resume workflow from current state
// 3. Advance to next agent if possible
```

### Skip Action

Skips optional workflow steps to speed up execution.

```typescript
const skipAction = {
  id: "skip-optional",
  label: "Skip Optional Steps",
  description: "Skip optional workflow steps",
  type: "skip",
  enabled: true,
  consequences: "Optional features will not be implemented",
  riskLevel: "low",
};

// Execution will:
// 1. Find optional steps that can be skipped
// 2. Mark them as 'skipped' with reason
// 3. Continue with required steps only
```

### Restart Action

Restarts the current workflow phase from the beginning.

```typescript
const restartAction = {
  id: "restart-phase",
  label: "Restart Phase",
  description: "Restart the planning phase",
  type: "restart",
  enabled: true,
  consequences: "Current phase progress will be lost",
  riskLevel: "medium",
};

// Execution will:
// 1. Clear current execution state
// 2. Reset workflow steps for current phase
// 3. Restart from phase beginning
```

### Modify Action

Opens modification interface for workflow parameters.

```typescript
const modifyAction = {
  id: "modify-settings",
  label: "Modify Settings",
  description: "Modify workflow parameters and preferences",
  type: "modify",
  enabled: true,
  riskLevel: "low",
};

// Execution will:
// 1. Show modifiable aspects
// 2. Allow user to make changes
// 3. Apply changes with validation
```

### Help Action

Provides contextual help and guidance.

```typescript
const helpAction = {
  id: "get-help",
  label: "Get Help",
  description: "Get contextual help and guidance",
  type: "help",
  enabled: true,
  riskLevel: "low",
};

// Execution will:
// 1. Analyze current workflow state
// 2. Generate contextual help content
// 3. Provide quick actions and guidance
```

## Advanced Features

### Dry Run Mode

Preview what an action would do without executing it:

```typescript
const result = await UserActionHandler.executeAction(
  chatId,
  action,
  modelId,
  dataStream,
  { dryRun: true }
);

console.log("Preview:", result.message);
// Output: "Would restart the planning phase"
```

### Consequence Analysis

Get detailed analysis of action consequences:

```typescript
const result = await UserActionHandler.executeAction(
  chatId,
  action,
  modelId,
  dataStream,
  { confirmConsequences: true }
);

console.log("Consequences:", result.consequences);
// Output: ['Current phase progress will be lost', 'All clarifications will be cleared']
```

### Action Validation

Actions are automatically validated before execution:

```typescript
// This will fail validation if no optional steps exist
const skipAction = {
  id: "skip-optional",
  type: "skip",
  // ... other properties
};

const result = await UserActionHandler.executeAction(
  chatId,
  skipAction,
  modelId,
  dataStream
);

if (!result.success) {
  console.log("Validation failed:", result.message);
  // Output: "Action validation failed: No optional steps available to skip"
}
```

## Integration with Workflow

### In Supervisor Agent

```typescript
import {
  UserActionHandler,
  createUserActionTools,
} from "./enhanced-conversation-state";

export function runSupervisorAgent(params) {
  // Create user action tools
  const userActionTools = createUserActionTools(
    params.chatId,
    params.dataStream,
    params.selectedChatModel.id
  );

  return streamText({
    model: myProvider.languageModel(params.selectedChatModel.id),
    tools: {
      ...existingTools,
      ...userActionTools,
    },
    // ... rest of configuration
  });
}
```

### In UI Components

```typescript
// React component example
function WorkflowActions({ chatId, modelId }) {
  const [availableActions, setAvailableActions] = useState([]);

  useEffect(() => {
    // Get available actions
    const actions = UserActionHandler.getAvailableActions(chatId, modelId);
    setAvailableActions(actions);
  }, [chatId, modelId]);

  const handleActionClick = async (action) => {
    const result = await UserActionHandler.executeAction(
      chatId,
      action,
      modelId,
      dataStream
    );

    if (result.success) {
      // Show success message
      showNotification(result.message);
    } else {
      // Show error
      showError(result.message);
    }
  };

  return (
    <div className="workflow-actions">
      {availableActions.map((action) => (
        <ActionButton
          key={action.id}
          action={action}
          onClick={() => handleActionClick(action)}
          disabled={!action.enabled}
        />
      ))}
    </div>
  );
}
```

## Error Handling

The UserActionHandler includes comprehensive error handling:

```typescript
try {
  const result = await UserActionHandler.executeAction(
    chatId,
    action,
    modelId,
    dataStream
  );

  if (!result.success) {
    // Handle validation or execution errors
    console.error("Action failed:", result.message);

    if (result.consequences) {
      // Show consequences to user
      showConsequences(result.consequences);
    }
  }
} catch (error) {
  // Handle unexpected errors
  console.error("Unexpected error:", error);
  showError("An unexpected error occurred while executing the action");
}
```

## Best Practices

1. **Always validate actions** before execution in production
2. **Use dry run mode** for previewing destructive actions
3. **Show consequences** to users for medium/high risk actions
4. **Provide undo information** when available
5. **Stream results to UI** for real-time feedback
6. **Handle errors gracefully** with user-friendly messages
7. **Respect user preferences** when determining available actions

## Customization

You can extend the UserActionHandler by:

1. Adding new action types to the `UserAction` interface
2. Implementing handlers for new action types
3. Customizing consequence analysis logic
4. Adding domain-specific validation rules
5. Extending the help system with custom content

## Performance Considerations

- Action validation is lightweight and fast
- Consequence analysis uses AI and may take 1-2 seconds
- State updates are atomic and consistent
- UI streaming provides immediate feedback
- Error recovery is built-in and automatic
