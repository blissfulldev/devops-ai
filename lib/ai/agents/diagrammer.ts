import {
  streamText,
  smoothStream,
  stepCountIs,
  convertToModelMessages,
  type UIMessageStreamWriter,
} from 'ai';
import { mcpTools } from '@/lib/ai/tools/mcp/aws-mcp';
import { requestClarification } from '@/lib/ai/tools/request-clarification';
import { myProvider } from '@/lib/ai/providers';
import { isProductionEnvironment } from '@/lib/constants';
import type { AgentRunner } from './types';
import { diagramSystemPrompt } from './system-prompts';
import { sanitizeUIMessages } from '@/lib/utils';
import type { ChatMessage } from '@/lib/types';
import type { Session } from 'next-auth';

// Wrap tools to normalize string args
function wrapTools(originalTools: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(originalTools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (input: any) => {
          let normalizedInput = input;
          if (typeof input === 'string') {
            try {
              normalizedInput = JSON.parse(input);
            } catch {
              // fallback: swap single quotes
              try {
                normalizedInput = JSON.parse(input.replace(/'/g, '"'));
              } catch {
                console.warn(
                  `[ToolWrapper] Could not parse string args for tool ${name}:`,
                  input,
                );
              }
            }
          }
          return await tool.execute(normalizedInput);
        },
      },
    ]),
  );
}

export const runDiagramAgent: AgentRunner = ({
  selectedChatModel,
  uiMessages,
  session,
  input,
  dataStream,
  telemetryId = 'agent-diagram',
  chatId,
}: {
  selectedChatModel: string;
  uiMessages: ChatMessage[];
  session: Session;
  input: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  telemetryId?: string;
  chatId?: string;
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
  const safeDiagramTools = wrapTools(diagramTools);
  const child = streamText({
    model: myProvider.languageModel(selectedChatModel),
    system: hasTools
      ? diagramSystemPrompt(chatId ?? 'default-diagram')
      : `${diagramSystemPrompt(`${chatId ?? 'default-diagram'}`)}\n\nNOTE: Diagram generation tools are currently unavailable. Please provide a detailed text-based architecture description instead.`,
    messages: [
      ...convertToModelMessages(sanitizeUIMessages(uiMessages)),
      { role: 'user', content: input },
    ],
    stopWhen: stepCountIs(12), // Allow enough steps: analyze + construct code + generate diagram + return result
    tools: {
      ...safeDiagramTools,
      requestClarification: requestClarification({
        dataStream,
        agentName: 'diagram_agent',
        chatId: chatId as string,
      }),
      // createDocument: createDocument({ session, dataStream }),
      // updateDocument: updateDocument({ session, dataStream }),
    },
    experimental_transform: smoothStream({ chunking: 'word' }),
    experimental_telemetry: {
      isEnabled: isProductionEnvironment,
      functionId: telemetryId,
    },
    // onFinish: (result) => {
    //   const imagePath = `/api/images/${chatId}.png`;
    //   // console.log('[MCP Tool Response] Image Path:', imagePath);
    //   dataStream.write({
    //     type: 'file',
    //     url: imagePath,
    //     mediaType: 'image/png', // Adjust if needed
    //   });
    // },
  });

  // Log all MCP tool call responses and stream image if present
  // (async () => {
  //   let foundImage = false;
  //   for await (const chunk of child.fullStream) {
  //     if (
  //       chunk.type === 'tool-result' &&
  //       chunk.toolName === 'generate_diagram' &&
  //       chunk.output &&
  //       typeof chunk.output === 'object' &&
  //       'path' in chunk.output.structuredContent &&
  //       chunk.output.structuredContent.status === 'success' &&
  //       !foundImage
  //     ) {
  //       foundImage = true;
  //       // console.log('[MCP Tool Response]', chunk);
  //       console.log(
  //         '[MCP Tool Response] Structured Content:',
  //         chunk.output?.structuredContent?.path,
  //       );
  //       const imagePath = `/api/images/${String(chunk.output?.structuredContent?.path).split('/').pop()}`;
  //       // console.log('[MCP Tool Response] Image Path:', imagePath);
  //       dataStream.write({
  //         type: 'file',
  //         url: imagePath,
  //         mediaType: 'image/png', // Adjust if needed
  //       });
  //     }
  //   }
  // })();

  return child;
};

