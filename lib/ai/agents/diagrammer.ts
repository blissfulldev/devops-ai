import {
  streamText,
  smoothStream,
  stepCountIs,
  convertToModelMessages,
} from 'ai';
import { mcpTools } from '@/lib/ai/tools/mcp/aws-mcp';
import { requestClarification } from '@/lib/ai/tools/request-clarification';
import { myProvider } from '@/lib/ai/providers';
import { isProductionEnvironment } from '@/lib/constants';
import type { AgentRunner } from './types';
import { diagramSystemPrompt } from './system-prompts';
import { sanitizeUIMessages } from '@/lib/utils';

export const runDiagramAgent: AgentRunner = ({
  selectedChatModel,
  uiMessages,
  input,
  dataStream,
  telemetryId = 'agent-diagram',
  chatId,
}) => {
  // Check if diagram tools are available with better error handling
  let diagramTools = {};
  let hasTools = false;

  try {
    console.log('Checking diagram tools availability...');
    console.log('mcpTools:', typeof mcpTools, Object.keys(mcpTools || {}));
    console.log(
      'mcpTools.diagram:',
      typeof (mcpTools as any).diagram,
      Object.keys((mcpTools as any).diagram || {}),
    );

    diagramTools = (mcpTools as any).diagram || {};
    hasTools = Object.keys(diagramTools).length > 0;

    console.log(
      `Diagram tools status: hasTools=${hasTools}, toolCount=${Object.keys(diagramTools).length}`,
    );

    // Validate that each tool is properly formed
    for (const [toolName, t] of Object.entries(diagramTools)) {
      if (!t || typeof t !== 'object') {
        console.warn(`Invalid tool detected: ${toolName}`, typeof t);
        delete (diagramTools as any)[toolName];
      } else {
        // log approximate input schema if available
        if ((t as any).inputSchema) {
          console.log(
            `Tool ${toolName} inputSchema keys:`,
            Object.keys((t as any).inputSchema),
          );
        }
      }
    }
  } catch (error) {
    console.error('Error checking diagram tools:', error);
    diagramTools = {};
    hasTools = false;
  }

  if (!hasTools) {
    console.warn('Diagram MCP tools not available, using fallback mode');
  }

  try {
    const child = streamText({
      model: myProvider.languageModel(selectedChatModel),
      system: hasTools
        ? diagramSystemPrompt
        : `${diagramSystemPrompt}\n\nNOTE: Diagram generation tools are currently unavailable. Please provide a detailed text-based architecture description instead.`,
      messages: [
        ...convertToModelMessages(sanitizeUIMessages(uiMessages)),
        { role: 'user', content: input },
      ],
      stopWhen: stepCountIs(4), // Allow enough steps: analyze + construct code + generate diagram + return result
      tools: {
        ...(diagramTools as Record<string, any>),
        requestClarification: requestClarification({
          dataStream,
          agentName: 'diagram_agent',
          chatId: chatId as string,
        }),
      },
      experimental_transform: smoothStream({ chunking: 'word' }),
      experimental_telemetry: {
        isEnabled: isProductionEnvironment,
        functionId: telemetryId,
      },
    });

    return child;
  } catch (error) {
    console.error('Error creating diagram agent stream:', error);
    // Return a fallback stream that just explains the error
    return streamText({
      model: myProvider.languageModel(selectedChatModel),
      system:
        'You are having technical difficulties. Explain that diagram generation is temporarily unavailable.',
      messages: [
        {
          role: 'user',
          content:
            'Diagram generation is currently experiencing technical difficulties. Please provide a detailed text description of the architecture instead.',
        },
      ],
      experimental_telemetry: {
        isEnabled: isProductionEnvironment,
        functionId: `${telemetryId}-fallback`,
      },
    });
  }
};
