import type { MCPConfig } from '~/lib/services/mcpService';

export type McpPresetId = 'recommended' | 'coding' | 'demo';

export type McpPreset = {
  id: McpPresetId;
  label: string;
  description: string;
  maxLLMSteps: number;
  config: MCPConfig;
};

export const MCP_PRESETS: Record<McpPresetId, McpPreset> = {
  recommended: {
    id: 'recommended',
    label: 'Recommended (free)',
    description: 'Fetch web pages, search docs (DeepWiki), and persistent memory. Best starting point.',
    maxLLMSteps: 10,
    config: {
      mcpServers: {
        deepwiki: {
          type: 'streamable-http',
          url: 'https://mcp.deepwiki.com/mcp',
        },
        fetch: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-fetch'],
        },
        memory: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-memory'],
        },
      },
    },
  },
  coding: {
    id: 'coding',
    label: 'Coding boost',
    description: 'DeepWiki + fetch + step-by-step reasoning for harder refactors.',
    maxLLMSteps: 12,
    config: {
      mcpServers: {
        deepwiki: {
          type: 'streamable-http',
          url: 'https://mcp.deepwiki.com/mcp',
        },
        fetch: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-fetch'],
        },
        'sequential-thinking': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
        },
      },
    },
  },
  demo: {
    id: 'demo',
    label: 'Demo / test tools',
    description: 'MCP reference server — useful to verify MCP is working.',
    maxLLMSteps: 8,
    config: {
      mcpServers: {
        everything: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-everything'],
        },
        deepwiki: {
          type: 'streamable-http',
          url: 'https://mcp.deepwiki.com/mcp',
        },
      },
    },
  },
};

export function mergeMcpConfigs(base: MCPConfig, addition: MCPConfig): MCPConfig {
  return {
    mcpServers: {
      ...base.mcpServers,
      ...addition.mcpServers,
    },
  };
}

export function countConfiguredServers(config: MCPConfig): number {
  return Object.keys(config.mcpServers || {}).length;
}

export function countAvailableTools(
  serverTools: Record<string, { status: string; tools?: Record<string, unknown> }>,
): number {
  return Object.values(serverTools).reduce((total, server) => {
    if (server.status !== 'available' || !server.tools) {
      return total;
    }

    return total + Object.keys(server.tools).length;
  }, 0);
}
