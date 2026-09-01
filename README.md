# google-ads-mcp-server

[![CI](https://github.com/getmcpads-com/google-ads-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/getmcpads-com/google-ads-mcp-server/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](package.json)

An open-source [Model Context Protocol](https://modelcontextprotocol.io) server for the
**Google Ads API**. It lets Claude, ChatGPT, Cursor or any MCP client read and analyse your
Google Ads data, plan keywords, and change campaigns if you choose to.

You run it. Your credentials stay on your machine. Nothing is proxied through a third party.

```bash
npx -y @getmcpads/google-ads-mcp-server
```

Also listed in the [MCP Registry](https://registry.modelcontextprotocol.io) as **`com.getmcpads/google-ads`**, so clients that read the registry can install it by name.

> **Prefer not to run it yourself?** [getmcpads.com](https://www.getmcpads.com) is the hosted
> version of this server, with Google Ads alongside Meta Ads, TikTok Ads, Pinterest Ads, GA4 and
> Search Console behind a single endpoint, hosted OAuth, and cross-platform reporting.
> Same tools, same safety model, no setup.

---

## What you get

| | |
|---|---|
| **31 read tools** | Campaigns, ad groups, budgets, bidding strategies, search terms, landing pages, Performance Max assets and placements, Shopping, recommendations, change history |
| **7 write tools** | Off by default. Status, budgets, bids, schedules, renames, campaign creation. Each one **previews before it applies** |
| **Full Keyword Planner** | Keyword ideas, historical metrics, forecasts, ad group themes, geo target suggestions |
| **130 metrics, 84 dimensions** | With a compatibility matrix that catches invalid combinations before they hit the API |
| **5 resources** | Live catalogues the model can read: metrics, dimensions, compatibility rules, 11 workflow recipes |
| **GAQL and beyond** | `google_ads_run_gaql` for raw queries, and `google_ads_run_readonly_rpc` for the services GAQL cannot reach |

### You do not need to know GAQL

The Google Ads API is queried with GAQL, its own query language, and most of its surface is
only reachable that way. This server carries the metric and dimension catalogues, so the model
asks for `cost` and `conversions` by name and the server writes the query.

`google_ads_validate_query` lets it check a combination before spending a call on it, and
`google_ads_run_gaql` is still there when you want to write GAQL yourself.

### Keyword Planner is not in GAQL

Keyword ideas, historical volumes and forecasts live in a separate RPC service that GAQL
cannot reach at all. Same for Reach Planner, audience insights and benchmarks. This server
covers them through `google_ads_run_readonly_rpc` and dedicated tools.

---

## How this compares to Google's own MCP server

Google shipped an official Google Ads MCP server in April 2026. It takes the opposite design
approach, and the comparison is more nuanced than for other platforms.

| | **This server** | Google's official server | [getmcpads.com](https://www.getmcpads.com) |
|---|---|---|---|
| Tools | **38** (31 read + 7 write) | 3: list accounts, GAQL search, resource metadata | 38, plus 5 other platforms |
| Hosting | **Self-hosted.** stdio, local process | Self-hosted (pipx) or Cloud Run | Hosted for you |
| Requires knowing GAQL | No, catalogues drive the query | **Yes**, for anything beyond listing accounts | No |
| Keyword Planner | **Yes.** Ideas, history, forecasts, ad group themes | Not available | Yes |
| Reach Planner, audience insights | **Yes**, through the read-only RPC | Not available | Yes |
| Performance Max diagnostics | **Yes**, dedicated tools | Through hand-written GAQL | Yes |
| Writes | **Yes, preview first.** Applied only on `confirm: true` | None, read-only by design | Yes, preview first |
| Metric compatibility | **Query planner splits incompatible requests** | None | Same planner |
| Auditable | **Yes.** Apache-2.0 | Yes, it is open too | This server, audited |

**Be fair about it.** Google's server is self-hostable too, so "your data stays on your
machine" is not a difference here. Its 3 tools are a deliberate minimalist design: one GAQL
tool can express most of the reporting surface, and a model fluent in GAQL will do a lot with
very little.

The difference is where the knowledge lives. There, it lives in the model, which has to write
correct GAQL against a schema of thousands of fields. Here, it lives in the server, in
catalogues and a compatibility matrix. Add to that the planning services GAQL cannot reach at
all, and writes that cannot fire on the first call.

**Choose Google's** if your model writes good GAQL and you only need reporting.
**Choose this one** if you want named metrics instead of query language, Keyword Planner and
Reach Planner access, or guarded writes.
**Choose [getmcpads.com](https://www.getmcpads.com)** if you want this server's capabilities
without running it, or you need more than one ad platform in the same conversation.

---

## Getting credentials

This is the heaviest setup of any advertising platform. Four values are needed, and one of
them requires a review by Google. Budget an hour the first time.

### 1. Developer token

From a **manager (MCC) account**, open **Tools → API Center** and apply for a token.
It starts at *Test Account* level, which only reaches test accounts. Apply for
**Basic Access** to reach live accounts. Google reviews the application, which can take a
few days.

📖 [Developer token documentation](https://developers.google.com/google-ads/api/docs/get-started/dev-token)

### 2. OAuth client

In a [Google Cloud project](https://console.cloud.google.com/), enable the **Google Ads API**,
then create an OAuth client under **APIs & Services → Credentials**. Choose **Desktop app**
for local use. Note the **client ID** and **client secret**.

### 3. Refresh token

Run the OAuth consent flow once, signed in as the Google account that can see your ad
accounts, and keep the **refresh token** it returns. Google's own helper script does this in
one command.

📖 [OAuth desktop flow](https://developers.google.com/google-ads/api/docs/oauth/cloud-project)

**The refresh token does not expire.** It is the sensitive value here: anyone holding it can
mint access tokens indefinitely. Treat it like a password, and use an OAuth client dedicated
to this server so you can revoke it on its own.

### 4. Login customer ID, if you use a manager account

If the accounts you query sit under an MCC, set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the manager
account ID. Dashes are accepted and stripped. Skip it for a standalone account.

You can also leave it unset. Google refuses any request against a managed account unless the
call names its manager, with a `USER_PERMISSION_DENIED` that mentions neither the account nor
the manager, so it reads as missing access rather than as a missing header. When the variable
is unset and the account you query is not directly accessible, the server asks the managers it
can reach which accounts they hold, and announces the one that holds yours. The answer is
resolved once and kept for the life of the process.

Setting the variable is still faster: it skips that discovery entirely, and it is the right
choice when every account you query sits under the same MCC.

Run **`google_ads_health_check`** as your first call. It verifies all four credentials, lists
the accounts you can actually reach, and reports what is missing, without printing any secret.

---

## Setup

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "npx",
      "args": ["-y", "@getmcpads/google-ads-mcp-server"],
      "env": {
        "GOOGLE_ADS_DEVELOPER_TOKEN": "your-developer-token",
        "GOOGLE_ADS_CLIENT_ID": "your-client-id",
        "GOOGLE_ADS_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_ADS_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

Restart Claude Desktop. Ask it: *"list my Google Ads accounts"*.

### Claude Code

```bash
claude mcp add google-ads --env GOOGLE_ADS_DEVELOPER_TOKEN=... --env GOOGLE_ADS_CLIENT_ID=... --env GOOGLE_ADS_CLIENT_SECRET=... --env GOOGLE_ADS_REFRESH_TOKEN=... -- npx -y @getmcpads/google-ads-mcp-server
```

### Cursor

`.cursor/mcp.json` in your project, same shape as the Claude Desktop config above.

### From source

```bash
git clone https://github.com/getmcpads-com/google-ads-mcp-server.git
cd google-ads-mcp-server
npm install && npm run build
cp .env.example .env   # then fill in your credentials
npm start
```

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | none | **Required.** From the API Center, Basic Access or above |
| `GOOGLE_ADS_CLIENT_ID` | none | **Required.** OAuth client ID |
| `GOOGLE_ADS_CLIENT_SECRET` | none | **Required.** OAuth client secret |
| `GOOGLE_ADS_REFRESH_TOKEN` | none | **Required.** From the consent flow |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | none | Optional. Manager (MCC) account ID. Resolved automatically when unset |
| `GOOGLE_ADS_ENABLE_WRITES` | *unset* | Set to `1` to register the 7 write tools |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

Check your setup at any time:

```bash
npm run doctor
```

---

## Writes, and why they preview first

Write tools are **disabled by default**. Enable them with `GOOGLE_ADS_ENABLE_WRITES=1`.
Google's own server has none at all, so this is the part to read carefully.

When enabled, every write tool returns a preview and changes nothing:

```jsonc
// google_ads_update_campaign_budget { customerId: "123-456-7890", budgetId: "555", dailyAmount: 50 }
{
  "applied": false,
  "action": "google_ads_update_campaign_budget",
  "change": { "customer": "1234567890", "budget": "555",
              "newDailyBudget": 50, "inMicros": 50000000 },
  "message": "Preview only, nothing was changed. Repeat the same call with confirm: true to apply this change to the live account."
}
```

Only a second call carrying `confirm: true` touches the live account.

This is deliberate. An assistant composes these calls, and it can pick the wrong customer, the
wrong campaign, or the wrong order of magnitude on a budget. A mandatory preview makes the
mistake visible before it costs money, and gives a human the stopping point the protocol does
not guarantee on its own.

Two further guardrails:

- **`google_ads_create_campaign` always creates the campaign `PAUSED`.** There is no option to
  create it active. Someone has to look at it before it spends.
- **Amounts are converted to micros for you.** Google holds money in millionths, so 12.50 in
  the account currency is `12500000`. The preview shows both, so a factor-of-a-thousand
  mistake is visible before it applies.

| Tool | What it changes |
|---|---|
| `google_ads_update_campaign_status` / `google_ads_update_adgroup_status` | Pause, re-enable or remove |
| `google_ads_update_campaign_budget` | Daily budget |
| `google_ads_update_adgroup_bid` | Default CPC bid |
| `google_ads_update_campaign_schedule` | Start and end dates |
| `google_ads_rename_campaign` | Name only |
| `google_ads_create_campaign` | Creates a budget, then a campaign, always `PAUSED` |

---

## Tools

<details>
<summary><b>31 read tools</b></summary>

### Discovery and health
| Tool | Purpose |
|---|---|
| `google_ads_health_check` | Validates all four credentials and lists reachable accounts |
| `google_ads_list_accounts` | Every account the credentials can reach |
| `google_ads_get_account_details` | Currency, timezone, status, account settings |
| `google_ads_get_account_hierarchy` | The MCC tree above and below an account |

### Structure and settings
| Tool | Purpose |
|---|---|
| `google_ads_get_campaigns` / `google_ads_get_adgroups` | List entities and their settings |
| `google_ads_get_budgets` / `google_ads_get_bidding_strategies` | Budgets and bidding configuration |
| `google_ads_get_conversion_actions` | Conversion actions and their settings |
| `google_ads_get_change_events` | Change history: who changed what, and when |

### Performance
| Tool | Purpose |
|---|---|
| `google_ads_get_insights` | The main reporting tool. Named metrics, no GAQL required |
| `google_ads_validate_query` | Check a metric and dimension combination *before* running it |
| `google_ads_get_keyword_performance` / `google_ads_get_search_terms` | Keyword and query performance |
| `google_ads_get_landing_pages` | Landing page performance |
| `google_ads_get_paid_organic_search_terms` | Paid and organic side by side |
| `google_ads_get_simulations` | Bid and budget simulations |
| `google_ads_get_recommendations` | Google's own recommendations for the account |

### Performance Max and Shopping
| Tool | Purpose |
|---|---|
| `google_ads_get_pmax_assets` / `google_ads_get_pmax_asset_diagnostics` | Asset groups, assets and their issues |
| `google_ads_get_pmax_placements` | Where Performance Max actually served |
| `google_ads_get_shopping_performance` / `google_ads_get_shopping_products` | Shopping performance and product data |

### Keyword Planner
| Tool | Purpose |
|---|---|
| `google_ads_generate_keyword_ideas` | Keyword ideas from seeds or a URL |
| `google_ads_generate_keyword_historical_metrics` | Volumes, competition, trends |
| `google_ads_generate_keyword_forecast_metrics` | Forecast clicks, cost and conversions |
| `google_ads_generate_ad_group_themes` | Suggested ad group groupings |
| `google_ads_suggest_geo_targets` | Resolve place names to geo target constants |

### Escape hatches
| Tool | Purpose |
|---|---|
| `google_ads_run_gaql` | Run a raw read-only GAQL SELECT |
| `google_ads_run_readonly_rpc` | Call an allowlisted non-GAQL read service: Reach Planner, audience insights, benchmarks |
| `google_ads_search_fields` | Search the API field schema |

These exist so a new field or service doesn't require a new release. Only read-only
statements and an allowlist of services are accepted.

</details>

<details>
<summary><b>5 resources</b></summary>

| URI | Contents |
|---|---|
| `google-ads://manifest` | What this server exposes, and which tool to run first |
| `google-ads://metrics` | All 130 metrics with categories and formats |
| `google-ads://dimensions` | All 84 dimensions and where they are valid |
| `google-ads://compatibility` | The compatibility matrix |
| `google-ads://recipes` | 11 step-by-step workflows |

</details>

---

## Security

This server holds a refresh token that never expires, a client secret and a developer token.
Concretely:

- **None of the four credentials is ever logged**, at any log level, or written to disk.
- **The access token is cached in memory** until a minute before expiry, rather than
  re-requested on every call.
- **Two hosts are contacted, and only two**: `googleads.googleapis.com` and
  `oauth2.googleapis.com`. *A test fails the build if a third host appears in the source.*
- **No fetch follows a redirect.** Every outbound call sets `redirect: "error"`, so a redirect
  cannot forward a bearer token or client secret to another host. *A test fails the build if
  any fetch omits this.*
- **No telemetry.** The server makes no network call other than to Google.

Full policy and reporting instructions: [SECURITY.md](SECURITY.md).

---

## Looking for a managed, multi-platform version?

This server does one platform, on your machine, with your credentials. That is on purpose.

If you'd rather not run it yourself, or you need Google Ads **alongside Meta Ads, TikTok Ads,
Pinterest Ads, GA4 and Search Console** behind one endpoint, with hosted OAuth and
cross-platform reporting, that's what we build at **[getmcpads.com](https://www.getmcpads.com)**.

Same philosophy, less plumbing. This project stays open source and independently useful
either way.

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
Please read [SECURITY.md](SECURITY.md) before reporting anything security-related.

## Licence

[Apache License 2.0](LICENSE). See also [NOTICE](NOTICE).

Google, Google Ads and the Google Ads API are trademarks of Google LLC.
**This project is not affiliated with, endorsed by, or sponsored by Google LLC.**
It is an independent client of a public API.
