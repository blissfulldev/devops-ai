# Human-in-the-Loop (HITL) Implementation

## Overview

This implementation adds Human-in-the-Loop capabilities to the multi-agent system, allowing agents to request clarification from users when requirements are unclear or when multiple valid approaches exist.

## Key Features

### 1. Clarification Request System

- **New Message Types**: Added `clarificationRequest` and `clarificationResponse` to the data stream
- **Priority Levels**: Requests can be marked as low, medium, or high priority
- **Context Awareness**: Each request includes context explaining why clarification is needed
- **Multiple Choice Options**: Agents can provide predefined options for users to choose from

### 2. Conversation State Management

- **Workflow Pausing**: Automatically pauses agent workflow when clarification is needed
- **State Persistence**: Tracks pending clarifications and responses
- **Resume Logic**: Automatically resumes workflow when all clarifications are received

### 3. Enhanced Agent Capabilities

- **Clarification Tool**: All agents now have access to `requestClarification` tool
- **Updated Prompts**: System prompts encourage asking questions instead of making assumptions
- **Context-Aware Questions**: Agents provide specific context and options when requesting clarification

### 4. Interactive UI Components

- **Clarification Dialog**: Modal dialog for responding to agent questions
- **Clarification Manager**: Shows all pending clarifications with priority indicators
- **Real-time Updates**: UI updates automatically when new clarifications are requested

## How It Works

### Agent Workflow

1. **Agent encounters ambiguity** → Uses `requestClarification` tool
2. **Workflow pauses** → ConversationStateManager tracks the request
3. **User receives notification** → UI shows clarification dialog
4. **User responds** → Response sent via API endpoint
5. **Workflow resumes** → Agent continues with clarified requirements

### Example Scenarios

#### Scenario 1: Core Agent Needs Architecture Details

```
User: "I need a web application on AWS"

Core Agent: "I need clarification to design the right architecture:
- What's your expected traffic volume? (Low: <1000 users, Medium: 1000-10000, High: >10000)
- Do you need a database? If yes, what type of data?
- Any specific compliance requirements?
- Budget constraints?"
```

#### Scenario 2: Terraform Agent Needs Implementation Details

```
Diagram Agent: Generated diagram with ALB + ECS + RDS

Terraform Agent: "I need clarification for the Terraform implementation:
- Which AWS region should I target?
- What instance sizes for ECS tasks? (Options: t3.micro, t3.small, t3.medium)
- Database instance class? (Options: db.t3.micro, db.t3.small, db.r5.large)
- Should I include auto-scaling configurations?"
```

## Implementation Details

### New Components

- `lib/ai/tools/request-clarification.ts` - Tool for agents to request clarification
- `lib/ai/conversation-state.ts` - Manages conversation state and clarifications
- `components/clarification-dialog.tsx` - UI dialog for responding to clarifications
- `components/clarification-manager.tsx` - Manages multiple pending clarifications
- `app/(chat)/api/clarification/route.ts` - API endpoint for handling responses

### Updated Components

- All agent files now include clarification capabilities
- System prompts updated to encourage asking questions
- Chat component integrated with clarification manager
- Type definitions extended with new message types

### Usage Examples

#### For Agents (in system prompts):

```
When requirements are unclear, use requestClarification:
- Question: "What's your expected user load?"
- Context: "I need to choose between Lambda (serverless) or ECS (containerized) based on scale"
- Options: ["Low (<1000 users)", "Medium (1000-10000)", "High (>10000)"]
- Priority: "high"
```

#### For Users:

1. Continue chatting normally
2. When agents need clarification, a notification appears
3. Click "Respond" to open the clarification dialog
4. Provide your answer or select from options
5. Workflow automatically resumes

## Benefits

1. **Better Requirements Gathering**: Agents ask specific, contextual questions
2. **Reduced Assumptions**: Less guesswork, more accurate implementations
3. **User Control**: Users can guide the architecture decisions
4. **Iterative Refinement**: Multiple clarification rounds for complex requirements
5. **Transparent Process**: Users understand why questions are being asked

## Future Enhancements

1. **Clarification History**: Track and learn from previous clarifications
2. **Smart Suggestions**: Use ML to suggest likely answers based on context
3. **Batch Clarifications**: Group related questions together
4. **Voice Clarifications**: Support for voice input/output
5. **Collaborative Clarifications**: Multiple users can provide input

## Testing the Implementation

1. Start a new chat
2. Ask for something ambiguous: "I need a scalable web app"
3. Watch as agents request clarification
4. Respond to the clarifications
5. See how the workflow continues with your specific requirements

This HITL implementation makes the agent system much more interactive and reliable, ensuring that the final infrastructure matches exactly what users need.
