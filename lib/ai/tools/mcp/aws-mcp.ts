import { experimental_createMCPClient as createMCPClient } from 'ai';

// Allow configuring MCP server URLs via env; fall back to sensible local defaults.
const CORE_URL = 'http://localhost:8000/sse';
const DIAGRAM_URL = 'http://localhost:8001/sse';
const TERRAFORM_URL = 'http://localhost:8002/sse';

async function initMcpTools() {
  const tools = {
    core: {},
    diagram: {},
    terraform: {},
  };

  // Helper function to safely initialize MCP client
  const initClient = async (name: string, url: string) => {
    try {
      console.log(`Initializing MCP ${name} client at ${url}...`);
      const client = await createMCPClient({
        transport: {
          type: 'sse',
          url: url,
        },
      });
      const tools = await client.tools();
      console.log(
        `MCP ${name} tools loaded:`,
        Object.keys(tools || {}).length,
        'tools',
      );

      // Validate tools object structure
      if (!tools || typeof tools !== 'object') {
        console.warn(
          `MCP ${name} returned invalid tools object:`,
          typeof tools,
        );
        return {};
      }

      // Filter out any malformed tools
      const validTools: Record<string, any> = {};
      for (const [toolName, tool] of Object.entries(tools)) {
        if (
          tool &&
          typeof tool === 'object' &&
          typeof tool.execute === 'function'
        ) {
          validTools[toolName] = tool;
        } else {
          console.warn(
            `MCP ${name} tool '${toolName}' is malformed:`,
            typeof tool,
          );
        }
      }

      console.log(
        `MCP ${name} valid tools:`,
        Object.keys(validTools).length,
        'of',
        Object.keys(tools).length,
      );
      return validTools;
    } catch (err: any) {
      console.warn(
        `MCP ${name} server unavailable at ${url}:`,
        err?.message ?? err,
      );
      return {}; // Return empty tools object as fallback
    }
  };

  // Initialize all MCP tools with error handling
  const [coreTools, diagramTools, terraformTools] = await Promise.all([
    initClient('core', CORE_URL),
    initClient('diagram', DIAGRAM_URL),
    initClient('terraform', TERRAFORM_URL),
  ]);

  tools.core = coreTools;
  tools.diagram = diagramTools;
  tools.terraform = terraformTools;

  return tools;
}

export const mcpTools = await initMcpTools();
