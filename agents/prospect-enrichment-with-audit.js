import { enrichProspect as enrichBaseProspect } from "./prospect-enrichment-base.js";
import { getOrRunWebsiteAudit } from "../lib/website-audit-runtime.js";

function compactAudit(audit) {
  if (!audit) return null;
  const { pages, ...summary } = audit;
  return summary;
}

function auditSummary(audit) {
  if (!audit) return "";

  const scores = audit.scores || {};
  const measured = [
    ["website health", audit.websiteHealthScore],
    ["content freshness", scores.contentFreshness],
    ["site structure", scores.siteStructure],
    ["conversion", scores.conversion],
    ["technical SEO", scores.technicalSeo],
    ["performance", scores.performance],
    ["mobile", scores.mobile],
    ["accessibility", scores.accessibility],
    ["structured data", scores.structuredData],
    ["platform health", scores.platformHealth],
    ["trust", scores.trust],
    ["AI discoverability", scores.aiDiscoverability]
  ]
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([label, value]) => label + " " + Number(value))
    .join(", ");

  const findings = (audit.findings || [])
    .slice(0, 4)
    .map((item) => item.finding)
    .filter(Boolean)
    .join(" ");

  const platform = audit.platform?.cmsDetected
    ? " Platform detected: " +
      audit.platform.cmsDetected +
      (audit.platform.cmsVersionDetected
        ? " " + audit.platform.cmsVersionDetected +
          " (detected version only; currency not independently verified)."
        : ".")
    : "";

  return (
    "Website Intelligence diagnostic (kept separate from the Marketing Opportunity Score): " +
    (measured || "limited measurable data") +
    ". " +
    findings +
    platform
  ).trim();
}

export async function enrichProspect({ industry, prospect }) {
  let websiteAudit = null;
  let websiteAuditCached = false;
  let websiteAuditError = null;

  try {
    const result = await getOrRunWebsiteAudit({ industry, prospect });
    websiteAudit = compactAudit(result.audit);
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
  const websiteSummary = auditSummary(websiteAudit);

  return {
    ...enrichment,
    opportunitySummary: websiteSummary
      ? enrichment.opportunitySummary + " " + websiteSummary
      : enrichment.opportunitySummary,
    websiteAudit,
    websiteAuditCached,
    websiteAuditError
  };
}
