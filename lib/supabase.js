import {
  checkSupabaseConnection as checkBaseSupabaseConnection
} from "./supabase-base.js";
import { checkWebsiteAuditSchema } from "./website-audit-store.js";

export * from "./supabase-base.js";

export async function checkSupabaseConnection() {
  const [base, website] = await Promise.all([
    checkBaseSupabaseConnection(),
    checkWebsiteAuditSchema()
  ]);

  const websiteReady = Boolean(website.configured && website.ready);

  return {
    ...base,
    connected: Boolean(base.connected && websiteReady),
    websiteIntelligenceReady: websiteReady,
    websiteIntelligence: website,
    diagnostic:
      base.diagnostic ||
      (!websiteReady
        ? {
            code: "WEBSITE_INTELLIGENCE_SCHEMA",
            message: "Website Intelligence migration 010 is not ready."
          }
        : null)
  };
}
