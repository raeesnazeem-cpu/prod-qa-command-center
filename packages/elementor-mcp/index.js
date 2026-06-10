import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import axios from "axios"

// Create the MCP server
const server = new Server(
  { name: "elementor-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
)

// Tell the system what tools we have available
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_elementor_links",
        description: "Gets the raw JSON data from the WordPress site securely",
        inputSchema: {
          type: "object",
          properties: {
            siteUrl: {
              type: "string",
              description:
                "The WordPress website URL like https://cfgns.myaestheticrecord.com",
            },
            pageUrl: {
              type: "string",
              description: "The full URL of the specific page",
            },
          },
          required: ["siteUrl", "pageUrl"],
        },
      },
    ],
  }
})

// Write the logic for the tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_elementor_links") {
    const siteUrl = request.params.arguments.siteUrl
    const pageUrl = request.params.arguments.pageUrl

    try {
      // We call our PHP Back Door, passing the URL
      const response = await axios.get(
        `${siteUrl}/wp-json/qacc/v1/layout?url=${encodeURIComponent(pageUrl)}`,
        {
          headers: {
            // This must exactly match what we put in the PHP file!
            Authorization: "Bearer MY_SUPER_SECRET_KEY_123",
          },
        },
      )

      // Return the JSON data back to the worker
      return {
        content: [{ type: "text", text: JSON.stringify(response.data) }],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: "Error fetching data from WP: " + error.message,
          },
        ],
        isError: true,
      }
    }
  }
})

// Start the server
const transport = new StdioServerTransport()
server.connect(transport)
