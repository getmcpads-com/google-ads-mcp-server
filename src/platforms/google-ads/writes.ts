/**
 * google-ads-mcp-server: an open-source MCP server for the Google Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Write tools for the Google Ads API.
 *
 * These are registered only when `GOOGLE_ADS_ENABLE_WRITES` is set. They reuse
 * the read client, so they share its cached OAuth token rather than refreshing
 * on every call.
 *
 * Part of google-ads-mcp-server: https://github.com/getmcpads-com/google-ads-mcp-server
 * Managed, multi-platform version: https://www.getmcpads.com
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GoogleAdsConfig } from "../../config.js";
import { GoogleAdsClient } from "./client.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function ko(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

/**
 * Every write is a preview until `confirm` is true.
 *
 * An assistant composes these calls, and it can pick the wrong customer, the
 * wrong campaign, or the wrong order of magnitude on a budget. A mandatory
 * preview makes the mistake visible before it costs money, and gives a human
 * the stopping point the protocol does not guarantee on its own.
 */
function preview(action: string, details: Record<string, unknown>) {
  return ok({
    applied: false,
    action,
    change: details,
    message:
      "Preview only, nothing was changed. Repeat the same call with confirm: true " +
      "to apply this change to the live account.",
  });
}

const confirmSchema = z
  .boolean()
  .optional()
  .describe("Set to true to actually apply the change. Without it, the tool only previews.");

const loginCustomerIdSchema = z
  .string()
  .optional()
  .describe("Manager account ID, when the customer sits under an MCC. Omit otherwise.");

/** Google Ads holds money in micros: 1.20 in the account currency is 1200000. */
function toMicros(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Expected a positive amount, received "${amount}".`);
  }
  return Math.round(amount * 1_000_000);
}

const stripDashes = (id: unknown) => String(id).replace(/-/g, "");

export function registerGoogleAdsWrites(server: McpServer, config: GoogleAdsConfig): void {
  const client = new GoogleAdsClient(config);

  const resourceName = (cid: string, collection: string, id: unknown) =>
    `customers/${cid}/${collection}/${id}`;

  // ── Status: pause, enable, remove ─────────────────────────────────
  const statusTool = (
    name: string,
    label: "campaign" | "ad group",
    param: string,
    collection: string,
  ) =>
    server.tool(
      name,
      `Pause, re-enable or remove a Google Ads ${label}. Previews by default: without ` +
        `confirm: true, the tool describes the change without applying it.`,
      {
        customerId: z.string().describe("Google Ads customer ID, with or without dashes."),
        [param]: z.string().describe(`${label} ID.`),
        status: z.enum(["PAUSED", "ENABLED", "REMOVED"]).describe("New status."),
        loginCustomerId: loginCustomerIdSchema,
        confirm: confirmSchema,
      },
      async (a: Record<string, unknown>) => {
        const cid = stripDashes(a.customerId);
        const id = String(a[param]);
        if (!a.confirm) {
          return preview(name, { customer: cid, target: id, newStatus: a.status });
        }
        const result = await client.mutate(cid, collection, [
          { update: { resourceName: resourceName(cid, collection, id), status: a.status }, updateMask: "status" },
        ], a.loginCustomerId as string | undefined);
        return ok({ applied: true, action: name, result });
      },
    );

  statusTool("google_ads_update_campaign_status", "campaign", "campaignId", "campaigns");
  statusTool("google_ads_update_adgroup_status", "ad group", "adGroupId", "adGroups");

  // ── Rename ────────────────────────────────────────────────────────
  server.tool(
    "google_ads_rename_campaign",
    "Rename a Google Ads campaign. The name is the only thing that changes: delivery, budget " +
      "and targeting are untouched. Previews by default.",
    {
      customerId: z.string().describe("Google Ads customer ID, with or without dashes."),
      campaignId: z.string().describe("Campaign ID."),
      name: z.string().min(1).max(255).describe("New campaign name."),
      loginCustomerId: loginCustomerIdSchema,
      confirm: confirmSchema,
    },
    async (a: Record<string, unknown>) => {
      const cid = stripDashes(a.customerId);
      if (!a.confirm) {
        return preview("google_ads_rename_campaign", { customer: cid, campaign: a.campaignId, newName: a.name });
      }
      const result = await client.mutate(cid, "campaigns", [
        { update: { resourceName: resourceName(cid, "campaigns", a.campaignId), name: a.name }, updateMask: "name" },
      ], a.loginCustomerId as string | undefined);
      return ok({ applied: true, action: "google_ads_rename_campaign", result });
    },
  );

  // ── Create campaign (always paused, budget first) ─────────────────
  server.tool(
    "google_ads_create_campaign",
    "Create a Google Ads campaign. It is always created PAUSED and there is no option to " +
      "create it active: someone has to look at it before it spends. Creates the campaign " +
      "budget too. Previews by default.",
    {
      customerId: z.string().describe("Google Ads customer ID, with or without dashes."),
      name: z.string().min(1).max(255).describe("Campaign name."),
      channelType: z
        .enum(["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "PERFORMANCE_MAX"])
        .describe("Advertising channel."),
      dailyBudget: z.number().positive().describe("Daily budget in the account currency."),
      budgetName: z
        .string()
        .min(1)
        .max(255)
        .describe("Name for the campaign budget. Google requires it to be unique on the account."),
      loginCustomerId: loginCustomerIdSchema,
      confirm: confirmSchema,
    },
    async (a: Record<string, unknown>) => {
      const cid = stripDashes(a.customerId);
      let micros: number;
      try {
        micros = toMicros(Number(a.dailyBudget));
      } catch (error) {
        return ko(error instanceof Error ? error.message : String(error));
      }
      if (!a.confirm) {
        return preview("google_ads_create_campaign", {
          customer: cid, name: a.name, channelType: a.channelType,
          dailyBudget: a.dailyBudget, inMicros: micros,
          budgetName: a.budgetName, status: "PAUSED",
        });
      }

      const login = a.loginCustomerId as string | undefined;
      // The budget has to exist before the campaign: Google refuses a campaign
      // without one, and the budget name has to be unique on the account.
      const budget = (await client.mutate(cid, "campaignBudgets", [
        {
          create: {
            name: a.budgetName,
            amountMicros: String(micros),
            deliveryMethod: "STANDARD",
          },
        },
      ], login)) as { results?: { resourceName: string }[] };

      const budgetResource = budget.results?.[0]?.resourceName;
      if (!budgetResource) {
        return ko("Google Ads did not return a budget resource name, so the campaign was not created.");
      }

      const campaign = await client.mutate(cid, "campaigns", [
        {
          create: {
            name: a.name,
            status: "PAUSED",
            advertisingChannelType: a.channelType,
            campaignBudget: budgetResource,
            manualCpc: {},
          },
        },
      ], login);

      return ok({
        applied: true,
        action: "google_ads_create_campaign",
        status: "PAUSED",
        budget: budgetResource,
        result: campaign,
      });
    },
  );

  // ── Budget and bid ────────────────────────────────────────────────
  server.tool(
    "google_ads_update_campaign_budget",
    "Change the daily budget of a Google Ads campaign. The amount is in the account currency " +
      "(12.50 for 12.50 EUR). Previews by default.",
    {
      customerId: z.string().describe("Google Ads customer ID, with or without dashes."),
      budgetId: z.string().describe("Campaign budget ID (campaign_budget.id)."),
      dailyAmount: z.number().positive().describe("New daily budget, in the account currency."),
      loginCustomerId: loginCustomerIdSchema,
      confirm: confirmSchema,
    },
    async (a: Record<string, unknown>) => {
      const cid = stripDashes(a.customerId);
      let micros: number;
      try {
        micros = toMicros(Number(a.dailyAmount));
      } catch (error) {
        return ko(error instanceof Error ? error.message : String(error));
      }
      if (!a.confirm) {
        return preview("google_ads_update_campaign_budget", {
          customer: cid, budget: a.budgetId, newDailyBudget: a.dailyAmount, inMicros: micros,
        });
      }
      const result = await client.mutate(cid, "campaignBudgets", [
        {
          update: {
            resourceName: resourceName(cid, "campaignBudgets", a.budgetId),
            amountMicros: String(micros),
          },
          updateMask: "amount_micros",
        },
      ], a.loginCustomerId as string | undefined);
      return ok({ applied: true, action: "google_ads_update_campaign_budget", result });
    },
  );

  server.tool(
    "google_ads_update_adgroup_bid",
    "Change the default CPC bid of a Google Ads ad group. The amount is in the account " +
      "currency (1.20 for 1.20 EUR). Has no effect on a campaign using an automated bidding " +
      "strategy. Previews by default.",
    {
      customerId: z.string().describe("Google Ads customer ID, with or without dashes."),
      adGroupId: z.string().describe("Ad group ID."),
      cpcBid: z.number().positive().describe("New default CPC bid, in the account currency."),
      loginCustomerId: loginCustomerIdSchema,
      confirm: confirmSchema,
    },
    async (a: Record<string, unknown>) => {
      const cid = stripDashes(a.customerId);
      let micros: number;
      try {
        micros = toMicros(Number(a.cpcBid));
      } catch (error) {
        return ko(error instanceof Error ? error.message : String(error));
      }
      if (!a.confirm) {
        return preview("google_ads_update_adgroup_bid", {
          customer: cid, adGroup: a.adGroupId, newCpcBid: a.cpcBid, inMicros: micros,
        });
      }
      const result = await client.mutate(cid, "adGroups", [
        {
          update: {
            resourceName: resourceName(cid, "adGroups", a.adGroupId),
            cpcBidMicros: String(micros),
          },
          updateMask: "cpc_bid_micros",
        },
      ], a.loginCustomerId as string | undefined);
      return ok({ applied: true, action: "google_ads_update_adgroup_bid", result });
    },
  );

  // ── Schedule ──────────────────────────────────────────────────────
  server.tool(
    "google_ads_update_campaign_schedule",
    "Change the start or end date of a Google Ads campaign. Dates are YYYY-MM-DD in the " +
      "account time zone. Previews by default.",
    {
      customerId: z.string().describe("Google Ads customer ID, with or without dashes."),
      campaignId: z.string().describe("Campaign ID."),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Start date, YYYY-MM-DD, in the account time zone."),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("End date, YYYY-MM-DD. Use 2037-12-30 to mean no end date, which is what Google stores."),
      loginCustomerId: loginCustomerIdSchema,
      confirm: confirmSchema,
    },
    async (a: Record<string, unknown>) => {
      const { startDate, endDate } = a as Record<string, string | undefined>;
      if (!startDate && !endDate) return ko("Provide startDate, endDate, or both.");
      if (startDate && endDate && startDate > endDate) {
        return ko(`startDate ${startDate} is after endDate ${endDate}.`);
      }
      const cid = stripDashes(a.customerId);
      const update: Record<string, unknown> = {
        resourceName: resourceName(cid, "campaigns", a.campaignId),
      };
      const mask: string[] = [];
      if (startDate) { update.startDate = startDate; mask.push("start_date"); }
      if (endDate) { update.endDate = endDate; mask.push("end_date"); }

      if (!a.confirm) {
        return preview("google_ads_update_campaign_schedule", {
          customer: cid, campaign: a.campaignId, startDate, endDate,
        });
      }
      const result = await client.mutate(cid, "campaigns", [
        { update, updateMask: mask.join(",") },
      ], a.loginCustomerId as string | undefined);
      return ok({ applied: true, action: "google_ads_update_campaign_schedule", result });
    },
  );
}
