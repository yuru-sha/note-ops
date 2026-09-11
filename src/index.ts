#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerMvpTools } from "./tools/mvp-tools.js";

const server = new McpServer({ name: "note-ops", version: "0.1.0" });
registerMvpTools(server);
await server.connect(new StdioServerTransport());
