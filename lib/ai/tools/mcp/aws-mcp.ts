import { experimental_createMCPClient as createMCPClient } from 'ai';

// Allow configuring MCP server URLs via env; fall back to sensible local defaults.
const CORE_URL = 'http://localhost:8000/sse';
const DIAGRAM_URL = 'http://localhost:8001/sse';
const TERRAFORM_URL = 'http://localhost:8002/sse';

// type MCPClient = Awaited<ReturnType<typeof createMCPClient>>;
// export type McpTools = Awaited<ReturnType<MCPClient['tools']>>;

// async function initClient(url: string): Promise<MCPClient> {
//   return createMCPClient({
//     transport: {
//       type: 'sse',
//       url: url,
//     },
//   });
// }

// // Export empty toolsets immediately; populate asynchronously to avoid failing route imports
// export const mcpTools: {
//   core: McpTools;
//   diagram: McpTools;
//   terraform: McpTools;
// } = {
//   core: {},
//   diagram: {},
//   terraform: {},
// };

// // Best-effort async initialization; failures are logged and do not crash the route
// void (async () => {
//   const initOne = async (label: keyof typeof mcpTools, url: string) => {
//     try {
//       const client = await initClient(url);
//       mcpTools[label] = await client.tools();
//     } catch (err: any) {
//       console.warn(`MCP ${label} tools unavailable:`, err?.message ?? err);
//     }
//   };

//   await Promise.all([
//     initOne('core', CORE_URL),
//     initOne('diagram', DIAGRAM_URL),
//     initOne('terraform', TERRAFORM_URL),
//   ]);
// })();

const coreMcpClient = await createMCPClient({
  transport: {
    type: 'sse',
    url: CORE_URL,
  },
});

const diagramMcpClient = await createMCPClient({
  transport: {
    type: 'sse',
    url: DIAGRAM_URL,
  },
});

const terraformMcpClient = await createMCPClient({
  transport: {
    type: 'sse',
    url: TERRAFORM_URL,
  },
});
export const mcpTools = {
  core: await coreMcpClient.tools(),
  diagram: await diagramMcpClient.tools(),
  terraform: await terraformMcpClient.tools(),
};
