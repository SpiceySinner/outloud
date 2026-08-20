import { sites } from "@openai/sites-vite-plugin";
import { resolve } from "node:path";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// Which host this build targets. Cloudflare stays the default so `npm run dev` keeps the
// Miniflare environment, worker/index.ts, and the bindings below exactly as before. Nitro takes
// over only when a Nitro preset is requested or Vercel's CI sets VERCEL=1 itself -- the two
// plugins own the same server output and cannot both be active.
const usesNitro = Boolean(process.env.NITRO_PRESET) || process.env.VERCEL === "1";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Both plugins are imported lazily: Wrangler snapshots its log path while the Cloudflare
  // plugin is imported, and a Vercel build should not pull Wrangler in at all.
  const hostPlugins = usesNitro
    ? [
        (await import("nitro/vite")).nitro({
          vercel: {
            // Nitro bundles the whole app into a single serverless function, so this budget is
            // shared by every route. The OpenAI-backed ones (coach, converse, rescue) are the
            // slow ones; 60s stays inside the Hobby ceiling and is far above what they need.
            functions: { maxDuration: 60 },
            // No cron is registered here on purpose. /api/retrieval only sends to subscriptions
            // that were verified by a Resend email, and Resend cannot send to real recipients
            // until OutLoud owns a domain to verify -- so a scheduled run would wake up hourly
            // and do nothing. When the domain exists, the job belongs in Supabase Cron rather
            // than here: Vercel throttles Hobby crons to about once a day, while this one needs
            // hourly granularity to deliver reminders near their 24h due time. See
            // VERCEL_SETUP.md.
          },
        }),
      ]
    : [
        (await import("@cloudflare/vite-plugin")).cloudflare({
          viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
          config: localBindingConfig,
        }),
      ];

  return {
    resolve: {
      alias: {
        "next/server": resolve("lib/next-server.ts"),
      },
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [vinext(), sites(), ...hostPlugins],
  };
});
