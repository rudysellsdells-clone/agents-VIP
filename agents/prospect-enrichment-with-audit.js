import { enrichProspect as enrichBaseProspect } from "./prospect-enrichment-base.js";
import { getOrRunWebsiteAudit } from "../lib/website-audit-runtime.js";

function marketingAreaForAuditArea(area) {
  const mapping = {
    content_freshness: "seo_content",
    site_structure: "website_ux",
    conversion: "conversion",
    technical_seo: "seo_content",
    structured_data: "seo_content",
    platform_health: "website_ux",
    site_hygiene: "website_ux",
    ai_discoverability: "ai_discovery",
    performance: "website_ux",
    mobile: "website_ux",
    accessibility: "website_ux",
    trust: "positioning"
  };

  return mapping[area] || "other";
}

function auditSignals(audit) {
  return (audit?.findings || []).slice(0, 8).map((finding) => ({
    area: marketingAreaForAuditArea(finding.area),
    type: "opportunity",
    finding: finding.finding,
    whyItMatters: finding.businessImplication,
    evidence: (finding.evidence || []).slice(0, 4)
  }));
}

function dedupeMarketingSignals(signals) {
  const seen = new Set();
  const output = [];

  for (const signal of signals) {
    const key = [signal.area, signal.type, signal.finding]
      .map((value) => String(value || "").trim().toLowerCase())
      .join("|");

    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(signal);
  }

  return output.slice(0, 20);
}

export async function enrichProspect({ industry, prospect }) {
  let websiteAudit = null;
  let websiteAuditCached = false;
  let websiteAuditError = null;

  try {
    const result = await getOrRunWebsiteAudit({ industry, prospect });
    websiteAudit = result.audit;
    websiteAuditCached = Boolean(result.cached);
    websiteAuditError = result.persistenceError || null;
  } catch (error) {
    websiteAuditError = String(error?.message || error).slice(0, 1000);
    console.warn(
      "Website Intelligence audit could not complete for",
      prospect.name,
      websiteAuditError
    );
  }

  const enrichment = await enrichBaseProspect({ industry, prospect });

  return {
    ...enrichment,
    marketingSignals: dedupeMarketingSignals([
      ...(enrichment.marketingSignals || []),
      ...auditSignals(websiteAudit)
    ]),
    websiteAudit,
    websiteAuditCached,
    websiteAuditError
  };
}
