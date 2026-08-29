/**
 * google-ads-mcp-server: an open-source MCP server for the Google Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GoogleAdsConfig } from "../../config.js";
import { registerGoogleAdsTools } from "./tools.js";
import { registerGoogleAdsResources } from "./resources.js";
import { registerGoogleAdsWrites } from "./writes.js";
import { logger } from "../../core/logger.js";

export function registerGoogleAds(server: McpServer, config: GoogleAdsConfig): void {
  registerGoogleAdsTools(server, config);
  registerGoogleAdsResources(server);
  logger.info("google-ads", "Registered 31 read tools and 5 resources");

  if (config.enableWrites) {
    registerGoogleAdsWrites(server, config);
    logger.info("google-ads", "Registered 7 write tools (every one previews before it applies)");
  }
}
