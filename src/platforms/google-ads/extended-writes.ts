import { webcrypto } from "node:crypto";
/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import type { ToolShape } from "../../tool-quality.js";

type Row = Record<string, any>;
type Collector = {
  tool: (
    name: string,
    description: string,
    shape: ToolShape,
    handler: (args: Row) => Promise<unknown>,
  ) => void;
};
export const GOOGLE_EXTENDED_WRITES = new Set([
  "google_ads_apply_plan",
  "google_ads_upload_video",
  "google_ads_remove_video_upload",
]);
const BASE = "https://googleads.googleapis.com/v25";
const resources = {
  conversionActionOperation: "conversionActions",
  campaignBudgetOperation: "campaignBudgets",
  campaignOperation: "campaigns",
  adGroupOperation: "adGroups",
  adGroupAdOperation: "adGroupAds",
  adOperation: "ads",
  assetOperation: "assets",
  assetGroupOperation: "assetGroups",
  assetGroupAssetOperation: "assetGroupAssets",
  campaignAssetOperation: "campaignAssets",
  campaignCriterionOperation: "campaignCriteria",
  adGroupCriterionOperation: "adGroupCriteria",
  assetGroupListingGroupFilterOperation: "assetGroupListingGroupFilters",
} as const;
const json = z.record(z.unknown());
const operation = z
  .object({
    kind: z.enum(
      Object.keys(resources) as [
        keyof typeof resources,
        ...(keyof typeof resources)[],
      ],
    ),
    create: json.optional(),
    update: json.optional(),
    remove: z.string().optional(),
    updateMask: z.string().min(1).optional(),
  })
  .strict();
const result = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }],
});

function canonical(v: any): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
async function digest(v: unknown) {
  return Array.from(
    new Uint8Array(
      await webcrypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(v)),
      ),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function previewData(v: any): any {
  if (Array.isArray(v)) return v.map(previewData);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        k === "data" && typeof x === "string"
          ? `[base64 media: ${x.length} characters]`
          : previewData(x),
      ]),
    );
  return v;
}
export function normalizeGooglePlan(customerId: string, input: unknown[]) {
  if (!/^\d{10}$/.test(customerId))
    throw new Error("Use a ten-digit customer ID.");
  const prefix = `customers/${customerId}/`;
  function check(v: any) {
    if (
      typeof v === "string" &&
      v.startsWith("customers/") &&
      !v.startsWith(prefix)
    )
      throw new Error(
        "Every customer resource must belong to the selected customerId.",
      );
    if (Array.isArray(v)) v.forEach(check);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (
          /access.?token|refresh.?token|developer.?token|authorization|client.?secret/i.test(
            k,
          )
        )
          throw new Error("Do not put credentials in a plan.");
        if (
          k === "data" &&
          typeof x === "string"
        ) {
          let valid = x.length > 0 && x.length <= 6_990_508 && /^[A-Za-z0-9+/]*={0,2}$/.test(x);
          try { valid = valid && atob(x).length <= 5 * 1024 * 1024; }
          catch { valid = false; }
          if (!valid) throw new Error("Image data must be base64, at most 5 MiB decoded.");
        }
        check(x);
      }
  }
  return input.map((raw) => {
    const op = operation.parse(raw);
    if (
      [op.create, op.update, op.remove].filter((x) => x !== undefined)
        .length !== 1
    )
      throw new Error(
        "Each operation needs exactly one of create, update or remove.",
      );
    if (op.update && !op.updateMask)
      throw new Error("Updates require an explicit updateMask.");
    if (op.kind === "adOperation" && op.update &&
        ("name" in op.update || op.updateMask?.split(",").some((field) => field.trim() === "name")))
      throw new Error("Google ad.name is immutable. Edit supported creative fields, or explicitly create a new paused ad with the desired name; never silently replace the original.");
    if (!op.update && op.updateMask)
      throw new Error("updateMask is only valid on updates.");
    if (
      op.updateMask &&
      /(^|,)\s*(\*|resource_name)\s*(,|$)/.test(op.updateMask)
    )
      throw new Error(
        "Use a precise updateMask; never wildcard or resource_name.",
      );
    const body: any = structuredClone(op.create ?? op.update);
    const expected = prefix + resources[op.kind] + "/";
    const resource = op.remove ?? body?.resourceName;
    if ((op.update || op.remove) && !resource)
      throw new Error("Update/remove requires a resource name.");
    if (
      resource &&
      (!resource.startsWith(expected) ||
        !/^-?\d+(~[A-Za-z0-9_-]+)*$/.test(resource.slice(expected.length)))
    )
      throw new Error(`Expected resource in ${expected}.`);
    if (
      op.create &&
      [
        "campaignOperation",
        "adGroupOperation",
        "adGroupAdOperation",
        "assetGroupOperation",
      ].includes(op.kind)
    ) {
      if (body.status && body.status !== "PAUSED")
        throw new Error("New campaigns, groups and ads must be PAUSED.");
      body.status = "PAUSED";
    }
    if (op.create && op.kind === "campaignOperation") {
      if (body.advertisingChannelType === "VIDEO")
        throw new Error(
          "Google Ads API cannot create VIDEO campaigns. Use an explicitly requested DEMAND_GEN video campaign instead.",
        );
      if (
        ![
          "CONTAINS_EU_POLITICAL_ADVERTISING",
          "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        ].includes(body.containsEuPoliticalAdvertising)
      )
        throw new Error(
          "Explicit EU political advertising declaration required.",
        );
    }
    const value = op.remove
      ? { remove: op.remove }
      : op.create
        ? { create: body }
        : { update: body, updateMask: op.updateMask };
    check(value);
    return { [op.kind]: value };
  });
}

export function registerGoogleExtendedWrites(
  c: Collector,
  config: Record<string, string>,
) {
  const original = c;
  const descriptions: Record<string, string> = {
    customerId: "Selected Google Ads customer ID, not the manager account.",
    currency:
      "Actual account currency as a three-letter ISO code; verified natively before writes.",
    loginCustomerId:
      "Optional MCC ID; defaults to the selected account's inferred manager.",
    testAccountOnly:
      "Require customer.test_account=true before writing. Always use true for sandbox acceptance.",
    confirm:
      "Apply only when true and expectedPlanHash matches the exact preview.",
    validateOnly:
      "Ask Google to validate without applying. Takes priority over confirm.",
    expectedPlanHash:
      "SHA-256 planHash from the preview of this exact payload, required for application.",
    uploadId:
      "Numeric ID of a video uploaded through Google Ads in this customer.",
    title: "Nonempty title for this new video upload.",
    mimeType: "Actual MIME type of the supplied video bytes.",
  };
  c = {
    tool: (n, d, shape, h) =>
      original.tool(
        n,
        d,
        Object.fromEntries(
          Object.entries(shape).map(([k, v]) => [
            k,
            v.description ? v : v.describe(descriptions[k] ?? k),
          ]),
        ),
        h,
      ),
  };
  registerGoogleVideoWrites(c, config);
  c.tool(
    "google_ads_apply_plan",
    "Preview, validate and atomically apply a Google Ads v25 build/change plan: campaigns, budgets, ad groups, RSA/Display/Demand Gen ads, image/text/YouTube assets, PMax asset groups and links, keywords, geographic/language targeting listing groups and conversion action configuration (no conversion event uploads). Native REST camelCase fields; amounts are integer micros of the explicitly stated currency. Supports temporary negative resource IDs for ordered creation in one transaction. No VIDEO campaign creation (Google API restriction), billing, account access changes, customer lists or conversion uploads. New campaigns/groups/ads are always PAUSED. Call first without confirm to inspect the plan and get planHash; validateOnly asks Google without applying; execution requires confirm and the matching expectedPlanHash. Read back results with google_ads_run_gaql. Never retry a creation after an uncertain network result before checking its name/IDs.",
    {
      customerId: z.string().regex(/^[\d-]+$/),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .describe(
          "Actual account currency, mandatory even when only linking assets.",
        ),
      operations: z
        .array(operation)
        .min(1)
        .max(100)
        .describe(
          "Ordered operations. kind is a native MutateOperation field; create/update contains native REST fields; remove is the full owned resource name. Images use imageAsset.data base64 bytes; videos use youtubeVideoAsset.youtubeVideoId (already uploaded on YouTube).",
        ),
      loginCustomerId: z
        .string()
        .regex(/^[\d-]+$/)
        .optional(),
      testAccountOnly: z
        .boolean()
        .optional()
        .describe(
          "Require Google's customer.test_account=true before any mutation. Use true for acceptance tests.",
        ),
      validateOnly: z.boolean().optional(),
      confirm: z.boolean().optional(),
      expectedPlanHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    },
    async (a) => {
      const cid = a.customerId.replace(/-/g, "");
      const operations = normalizeGooglePlan(cid, a.operations);
      if (JSON.stringify(operations).length > 12_000_000)
        throw new Error(
          "Plan too large; upload assets in separate confirmed plans and reference their resource names.",
        );
      const manager = (a.loginCustomerId ?? config.loginCustomerId)?.replace(
        /-/g,
        "",
      );
      const planHash = await digest({
        customerId: cid,
        currency: a.currency,
        manager: manager ?? null,
        testAccountOnly: a.testAccountOnly === true,
        operations,
      });
      if (!a.confirm && !a.validateOnly)
        return result({
          applied: false,
          planHash,
          customerId: cid,
          currency: a.currency,
          operationCount: operations.length,
          operations: previewData(operations),
        });
      if (a.confirm && !a.validateOnly && a.expectedPlanHash !== planHash)
        throw new Error(
          "Preview this exact plan first and provide its matching expectedPlanHash.",
        );
      const { api, customer } = await googleSession(
        config,
        cid,
        a.currency,
        a.testAccountOnly,
        manager,
      );
      const response = await api("googleAds:mutate", {
        mutateOperations: operations,
        partialFailure: false,
        validateOnly: a.validateOnly === true,
      });
      return result({
        applied: a.validateOnly !== true,
        validatedByGoogle: true,
        planHash,
        operationCount: operations.length,
        customerId: cid,
        currency: a.currency,
        testAccount: customer.testAccount === true,
        result: response,
      });
    },
  );
}

async function googleSession(
  config: Record<string, string>,
  cid: string,
  currency: string,
  testAccountOnly: boolean,
  manager?: string,
) {
  const auth = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }),
  redirect: "error"});
  const token: any = await auth.json();
  if (!auth.ok || !token.access_token)
    throw new Error(
      "Google authorization could not be refreshed. Reconnect the Google Ads source.",
    );
  const headers: Record<string, string> = {
    authorization: `Bearer ${token.access_token}`,
    "developer-token": config.developerToken,
    "content-type": "application/json",
  };
  if (manager) headers["login-customer-id"] = manager;
  async function api(path: string, body: unknown) {
    const r = await fetch(`${BASE}/customers/${cid}/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    redirect: "error"});
    const x: any = await r.json();
    if (!r.ok) {
      const errors = x.error?.details
        ?.flatMap((d: any) => d.errors ?? [])
        .map((e: any) => ({
          code: e.errorCode,
          message: e.message,
          location: e.location,
        }));
      throw new Error(
        `Google Ads: ${JSON.stringify(errors?.length ? errors : (x.error?.message ?? r.status)).slice(0, 4000)}`,
      );
    }
    return x;
  }
  const read = await api("googleAds:search", {
    query:
      "SELECT customer.id, customer.currency_code, customer.test_account FROM customer",
  });
  const customer = read.results?.[0]?.customer;
  if (customer?.id !== cid || customer?.currencyCode !== currency)
    throw new Error("Customer identity or currency does not match the plan.");
  if (testAccountOnly && customer.testAccount !== true)
    throw new Error("This plan requires a Google test account.");
  return { headers, api, customer };
}

function registerGoogleVideoWrites(
  c: Collector,
  config: Record<string, string>,
) {
  const common = {
    customerId: z.string().regex(/^[\d-]+$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    loginCustomerId: z
      .string()
      .regex(/^[\d-]+$/)
      .optional(),
    testAccountOnly: z.boolean().optional(),
    confirm: z.boolean().optional(),
    expectedPlanHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  };
  c.tool(
    "google_ads_upload_video",
    "Upload MP4/WebM/QuickTime bytes (max 16 MiB) to the Google-managed YouTube channel for the selected ad account. Visibility is UNLISTED: viewable by anyone with the link, not private. Default preview omits bytes and returns planHash; confirm requires expectedPlanHash. This API has no validateOnly. After upload, query you_tube_video_upload.state and video_id with google_ads_run_gaql; only use the video ID after PROCESSED, via google_ads_apply_plan assetOperation.youtubeVideoAsset. No automatic retry after an uncertain upload.",
    {
      ...common,
      bytesBase64: z
        .string()
        .min(4)
        .max(22_369_624)
        .describe(
          "Raw base64 video bytes, no data URL. Prefer an existing YouTube asset for large videos.",
        ),
      mimeType: z.enum(["video/mp4", "video/webm", "video/quicktime"]),
      title: z.string().trim().min(1).max(100),
      description: z
        .string()
        .trim()
        .min(1)
        .max(5000)
        .describe(
          "Nonempty video description; Google rejects an empty value during upload.",
        ),
      visibility: z
        .literal("UNLISTED")
        .describe(
          "Explicit acknowledgment of the visibility of this YouTube upload.",
        ),
    },
    async (a) => {
      const cid = a.customerId.replace(/-/g, "");
      if (!/^\d{10}$/.test(cid))
        throw new Error("Use a ten-digit customer ID.");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(a.bytesBase64))
        throw new Error("Invalid base64 video.");
      let binary: string;
      try {
        binary = atob(a.bytesBase64);
      } catch {
        throw new Error("Invalid base64 video.");
      }
      if (binary.length > 16 * 1024 * 1024)
        throw new Error("Video exceeds 16 MiB.");
      const manager = (a.loginCustomerId ?? config.loginCustomerId)?.replace(
        /-/g,
        "",
      );
      const planHash = await digest({
        customerId: cid,
        currency: a.currency,
        manager: manager ?? null,
        testAccountOnly: a.testAccountOnly === true,
        title: a.title,
        description: a.description ?? "",
        mimeType: a.mimeType,
        visibility: a.visibility,
        bytes: a.bytesBase64,
      });
      if (!a.confirm)
        return result({
          applied: false,
          planHash,
          customerId: cid,
          title: a.title,
          description: a.description,
          mimeType: a.mimeType,
          visibility: a.visibility,
          byteLength: binary.length,
        });
      if (a.expectedPlanHash !== planHash)
        throw new Error(
          "Preview this exact upload first and supply expectedPlanHash.",
        );
      const { headers } = await googleSession(
        config,
        cid,
        a.currency,
        a.testAccountOnly,
        manager,
      );
      const start = await fetch(
        `https://googleads.googleapis.com/resumable/upload/v25/customers/${cid}/youTubeVideoUploads:create`,
        {
          method: "POST",
          headers: {
            ...headers,
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(binary.length),
          },
          body: JSON.stringify({
            customer_id: cid,
            you_tube_video_upload: {
              video_title: a.title,
              video_description: a.description ?? "",
              video_privacy: "UNLISTED",
            },
          }),
        redirect: "error"},
      );
      if (!start.ok)
        throw new Error(
          `Google video upload initiation failed (${start.status}). No automatic retry.`,
        );
      const target = start.headers.get("x-goog-upload-url");
      if (
        !target ||
        new URL(target).origin !== "https://googleads.googleapis.com"
      )
        throw new Error(
          "Unexpected Google upload URL; no bytes or credentials sent.",
        );
      const uploaded = await fetch(target, {
        method: "PUT",
        headers: {
          ...headers,
          "content-type": a.mimeType,
          "X-Goog-Upload-Offset": "0",
          "X-Goog-Upload-Command": "upload, finalize",
        },
        body: Uint8Array.from(binary, (c) => c.charCodeAt(0)),
      redirect: "error"});
      if (!uploaded.ok) {
        const error: any = await uploaded.json().catch(() => ({}));
        throw new Error(
          `Google video upload failed (${uploaded.status}): ${String(error.error?.message ?? "unknown error").slice(0, 700)}. Inspect you_tube_video_upload before retrying.`,
        );
      }
      const response: any = await uploaded.json();
      if (
        !String(response.resourceName).startsWith(
          `customers/${cid}/youTubeVideoUploads/`,
        )
      )
        throw new Error(
          "Google did not return an owned video upload resource. Inspect uploads before retrying.",
        );
      return result({
        applied: true,
        planHash,
        resourceName: response.resourceName,
        visibility: "UNLISTED",
        nextAction:
          "Query you_tube_video_upload.state and video_id; wait for PROCESSED before creating the video asset.",
      });
    },
  );
  c.tool(
    "google_ads_remove_video_upload",
    "Remove a video upload owned by the selected ad account. Deletes the uploaded YouTube video and can break ads referencing it. Preview and matching expectedPlanHash required. Google v25 marks title/description immutable; this tool does not pretend to edit them.",
    { ...common, uploadId: z.string().regex(/^\d+$/) },
    async (a) => {
      const cid = a.customerId.replace(/-/g, "");
      if (!/^\d{10}$/.test(cid))
        throw new Error("Use a ten-digit customer ID.");
      const manager = (a.loginCustomerId ?? config.loginCustomerId)?.replace(
        /-/g,
        "",
      );
      const resourceName = `customers/${cid}/youTubeVideoUploads/${a.uploadId}`;
      const planHash = await digest({
        customerId: cid,
        currency: a.currency,
        manager: manager ?? null,
        testAccountOnly: a.testAccountOnly === true,
        remove: resourceName,
      });
      if (!a.confirm)
        return result({ applied: false, planHash, remove: resourceName });
      if (a.expectedPlanHash !== planHash)
        throw new Error(
          "Preview this exact removal first and supply expectedPlanHash.",
        );
      const { api } = await googleSession(
        config,
        cid,
        a.currency,
        a.testAccountOnly,
        manager,
      );
      return result({
        applied: true,
        planHash,
        result: await api("youTubeVideoUploads:remove", {
          resourceNames: [resourceName],
        }),
      });
    },
  );
}
