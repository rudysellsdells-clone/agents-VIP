import { enrichProspect as enrichBaseProspect } from "./prospect-enrichment-base.js";
import { getOrRunWebsiteAudit } from "../lib/website-audit-runtime.js";

function compactAudit(audit) {
  if (!audit) return null;
  const { pages, ...summary } = audit;
  return summary;
}

function auditScoreLine(audit) {
  if (!audit) return "";
  const scores = audit.scores || {};
  return [
    ["Health", audit.websiteHealthScore],
    ["Freshness", scores.contentFreshness],
    ["Structure", scores.siteStructure],
    ["Conversion", scores.conversion],
    ["SEO", scores.technicalSeo],
    ["Performance", scores.performance],
    ["Mobile", scores.mobile],
    ["Accessibility", scores.accessibility],
    ["Schema", scores.structuredData],
    ["Platform", scores.platformHealth],
    ["Trust", scores.trust],
    ["AI discoverability", scores.aiDiscoverability]
  ]
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([label, value]) => label + " " + Number(value) + "/100")
    .join(" • ");
}

function auditSummary(audit) {
  if (!audit) return "";

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
    "Website Intelligence diagnostic, separate from the Marketing Opportunity Score: " +
    (auditScoreLine(audit) || "limited measurable data") +
    ". " + findings + platform
  ).trim();
}

function auditObservation(audit) {
  if (!audit) return null;

  const evidence = (audit.findings || [])
    .flatMap((item) => item.evidence || [])
    .filter((item) => item?.url && item?.fact)
    .slice(0, 4);

  if (!evidence.length && audit.website) {
    evidence.push({
      url: audit.website,
      fact: "Direct first-party Website Intelligence measurement."
    });
  }

  return {
    area: "other",
    type: "unknown",
    finding:
      "Website Intelligence scorecard — " +
      (auditScoreLine(audit) || "limited measurable data"),
    whyItMatters:
      "This diagnostic is stored separately from Agent 3 scoring. It identifies measurable website modernization opportunities that can inform human review and outreach.",
    evidence
  };
}

export async function enrichProspect({ industry, prospect }) {
  const [auditResult, enrichmentResult] = await Promise.allSettled([
    getOrRunWebsiteAudit({ industry, prospect }),
    enrichBaseProspect({ industry, prospect })
  ]);

  if (enrichmentResult.status === "rejected") {
    throw enrichmentResult.reason;
  }

  const enrichment = enrichmentResult.value;
  let websiteAudit = null;
  let websiteAuditCached = false;
  let websiteAuditError = null;

  if (auditResult.status === "fulfilled") {
    websiteAudit = compactAudit(auditResult.value.audit);
    websiteAuditCached = Boolean(auditResult.value.cached);
    websiteAuditError = auditResult.value.persistenceError || null;
  } else {
    websiteAuditError = String(
      auditResult.reason?.message || auditResult.reason
    ).slice(0, 1000);
    console.warn(
      "Website Intelligence audit could not complete for",
      prospect.name,
      websiteAuditError
    );
  }

  const websiteSummary = auditSummary(websiteAudit);
  const observation = auditObservation(websiteAudit);

  return {
    ...enrichment,
    opportunitySummary: websiteSummary
      ? enrichment.opportunitySummary + " " + websiteSummary
      : enrichment.opportunitySummary,
    marketingSignals: observation
      ? [...(enrichment.marketingSignals || []), observation]
      : enrichment.marketingSignals,
    websiteAudit,
    websiteAuditCached,
    websiteAuditError
  };
}
