import {
  streamText,
  smoothStream,
  stepCountIs,
  convertToModelMessages,
  type UIMessageStreamWriter,
} from 'ai';
import * as fs from 'node:fs/promises';
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
  session: _session,
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
    onFinish: async (result) => {
      console.log('[Diagram Agent] onFinish called with result:', result);

      // Try multiple possible image file paths
      const possiblePaths = [
        `./workspace/generated-diagrams/${chatId}.png`,
        `./workspace/${chatId}.png`,
        `./generated-diagrams/${chatId}.png`,
        `./diagrams/${chatId}.png`,
      ];

      let imageFound = false;

      for (const imageFilePath of possiblePaths) {
        try {
          const imageBuffer = await fs.readFile(imageFilePath);
          const base64Image = imageBuffer.toString('base64');
          console.log(
            `[Diagram Agent] Successfully read image from: ${imageFilePath}`,
          );

          dataStream.write({
            type: 'file',
            url: `data:image/png;base64,${base64Image}`,
            mediaType: 'image/png',
          });

          imageFound = true;
          break;
        } catch (err) {
          console.log(
            `[Diagram Agent] Could not read image from ${imageFilePath}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      if (!imageFound) {
        console.warn(
          '[Diagram Agent] No diagram image found in any expected location',
        );
        // Send a completion message even if no image was found
        dataStream.write({
          type: 'text-delta',
          delta:
            '\n\n✅ Diagram generation completed. (No image file was generated)',
          id: `completion-${Date.now()}`,
        });
      } else {
        // Send completion message when image is found
        dataStream.write({
          type: 'text-delta',
          delta: '\n\n✅ Diagram generated successfully!',
          id: `success-${Date.now()}`,
        });
      }

      // Always signal completion
      console.log('[Diagram Agent] Signaling completion to UI');
      dataStream.write({
        type: 'finish',
      });
    },
  });

  // Log all MCP tool call responses and stream image if present
  (async () => {
    let foundImage = false;
    for await (const chunk of child.fullStream) {
      // Log all tool results for debugging
      if (chunk.type === 'tool-result') {
        console.log(
          `[Diagram Agent] Tool result - Name: ${chunk.toolName}, Type: ${chunk.type}`,
        );
        console.log(`[Diagram Agent] Tool output:`, chunk.output);
      }

      if (
        chunk.type === 'tool-result' &&
        chunk.toolName === 'generate_diagram' &&
        chunk.output &&
        typeof chunk.output === 'object' &&
        !foundImage
      ) {
        foundImage = true;
        console.log('[MCP Tool Response]', chunk);
        console.log(
          '[MCP Tool Response] Structured Content:',
          (chunk.output as any)?.structuredContent,
        );

        // Handle different response formats
        let imagePath: string | undefined;
        const output = chunk.output as any;

        if (output.structuredContent?.path) {
          imagePath = `/api/images/${String(output.structuredContent.path).split('/').pop()}`;
        } else if (output.path) {
          imagePath = `/api/images/${String(output.path).split('/').pop()}`;
        } else if (typeof output === 'string' && output.includes('.png')) {
          // Handle case where output is a string path
          imagePath = `/api/images/${output.split('/').pop()}`;
        }

        if (imagePath) {
          console.log('[MCP Tool Response] Image Path:', imagePath);
          dataStream.write({
            type: 'file',
            url: imagePath,
            mediaType: 'image/png',
          });

          // Also send a completion message
          dataStream.write({
            type: 'text-delta',
            delta:
              '\n\n🎨 Diagram has been generated and is ready for viewing!',
            id: `diagram-ready-${Date.now()}`,
          });
        } else {
          console.warn(
            '[MCP Tool Response] No valid image path found in output:',
            chunk.output,
          );
          // Try to extract any useful information from the output
          const output = chunk.output as any;
          if (output.message || output.status) {
            dataStream.write({
              type: 'text-delta',
              delta: `\n\n📋 Diagram tool response: ${output.message || output.status}`,
              id: `tool-response-${Date.now()}`,
            });
          }
        }
      }
    }
  })();

  return child;
};
