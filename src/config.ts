/**
 * google-ads-mcp-server: an open-source MCP server for the Google Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from "zod";
import { logger } from "./core/logger.js";

const configSchema = z.object({
  developerToken: z.string().min(1, "GOOGLE_ADS_DEVELOPER_TOKEN is required"),
  clientId: z.string().min(1, "GOOGLE_ADS_CLIENT_ID is required"),
  clientSecret: z.string().min(1, "GOOGLE_ADS_CLIENT_SECRET is required"),
  refreshToken: z.string().min(1, "GOOGLE_ADS_REFRESH_TOKEN is required"),
  loginCustomerId: z.string().optional(),
  /** Write tools are registered only when this is true. */
  enableWrites: z.boolean().optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type GoogleAdsConfig = z.infer<typeof configSchema>;

export function loadConfig(): GoogleAdsConfig {
  const raw = {
    developerToken: process.env["GOOGLE_ADS_DEVELOPER_TOKEN"] ?? "",
    clientId: process.env["GOOGLE_ADS_CLIENT_ID"] ?? "",
    clientSecret: process.env["GOOGLE_ADS_CLIENT_SECRET"] ?? "",
    refreshToken: process.env["GOOGLE_ADS_REFRESH_TOKEN"] ?? "",
    loginCustomerId: process.env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"] || undefined,
    enableWrites: isTruthy(process.env["GOOGLE_ADS_ENABLE_WRITES"]),
    logLevel: process.env["LOG_LEVEL"] ?? "info",
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const missing = result.error.issues.map(i => i.message).join(", ");
    logger.error("config", `Missing credentials: ${missing}`);
    throw new Error(`Missing Google Ads credentials: ${missing}`);
  }

  return result.data;
}

/** Accepts the spellings people actually type in an MCP client config. */
function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
