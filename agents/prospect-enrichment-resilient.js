import { Agent, run, webSearchTool } from "@openai/agents";
import { getIndustryConfig } from "../config/industries.js";
import { enrichProspect as enrichPrimary } from "./prospect-enrichment-with-audit.js";
import { getOrRunWebsiteAudit } from "../lib/website-audit-runtime.js";

const fallbackModel =
  process.env.ENRICHMENT_RESEARCH_MODEL ||
  process.env.DISCOVERY_RESEARCH_MODEL ||
  process.env.DISCOVERY_MODEL ||
  "gpt-5.6-luna";

function safeError(error) {
  return String(error?.message || error || "Unknown enrichment error.").slice(0, 1200);
}

function validUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function validEmail(value) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function clampConfidence(value, fallback = 50) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.max(0, Math.min(100, Math.round(n)))
    : fallback;
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseLooseJson(value) {
  const raw = String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(raw);
  } catch {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(raw.slice(first, last + 1));
    }
    throw new Error("Fallback enrichment returned invalid JSON.");
  }
}

function normalizeEvidence(items, fallbackUrl) {
  const output = [];
  for (const item of Array.isArray(items) ? items : []) {
    const url = validUrl(item?.url) || validUrl(fallbackUrl);
    const fact = text(item?.fact);
    if (url && fact) output.push({ url, fact });
    if (output.length >= 4) break;
  }
  return output;
}

function roleCategory(value) {
  const role = String(value || "").toLowerCase().replace(/[^a-z]+/g, "_");
  if (["owner", "founder", "partner", "managing_partner", "principal", "shareholder"].includes(role)) return "owner";
  if (["executive", "ceo", "president", "managing_attorney", "attorney", "lawyer", "director"].includes(role)) return "executive";
  if (role.includes("marketing")) return "marketing";
  if (role.includes("operation") || role.includes("administrator")) return "operations";
  if (role.includes("business") || role.includes("development") || role.includes("growth")) return "business_development";
  return "other";
}

function contactType(value) {
  const type = String(value || "").toLowerCase().replace(/[^a-z]+/g, "_");
  if (type.includes("email")) return "email";
  if (type.includes("phone") || type.includes("telephone")) return "phone";
  if (type.includes("form")) return "contact_form";
  if (type.includes("linkedin") && type.includes("person")) return "linkedin_professional";
  if (type.includes("linkedin")) return "linkedin_company";
  return "other";
}

function marketingArea(value) {
  const area = String(value || "").toLowerCase().replace(/[^a-z]+/g, "_");
  if (area.includes("conversion") || area.includes("cta") || area.includes("lead")) return "conversion";
  if (area.includes("seo") || area.includes("content") || area.includes("search")) return "seo_content";
  if (area.includes("website") || area.includes("ux") || area.includes("user_experience")) return "website_ux";
  if (area.includes("position") || area.includes("message") || area.includes("brand")) return "positioning";
  if (area.includes("review") || area.includes("reputation")) return "reviews_reputation";
  if (area.includes("social")) return "social";
  if (area.includes("paid") || area.includes("ppc") || area.includes("advert")) return "paid_visibility";
  if (area.includes("ai") || area.includes("llm") || area.includes("generative")) return "ai_discovery";
  if (area.includes("compet")) return "competitive";
  return "other";
}

function marketingType(value) {
  const type = String(value || "").toLowerCase();
  if (type.includes("strength") || type.includes("positive")) return "strength";
  if (type.includes("opportun") || type.includes("weak") || type.includes("gap")) return "opportunity";
  return "unknown";
}

function compactAudit(audit) {
  if (!audit) return null;
  const { pages, ...summary } = audit;
  return summary;
}

function auditObservation(audit) {
  if (!audit) return null;
  const evidence = (audit.findings || [])
    .flatMap((item) => item.evidence || [])
    .filter((item) => validUrl(item?.url) && text(item?.fact))
    .slice(0, 4)
    .map((item) => ({ url: validUrl(item.url), fact: text(item.fact) }));

  if (!evidence.length && validUrl(audit.website)) {
    evidence.push({
      url: validUrl(audit.website),
      fact: "Direct first-party Website Intelligence measurement."
    });
  }

  if (!evidence.length) return null;

  return {
    area: "other",
    type: "unknown",
    finding:
      "Website Intelligence health score: " +
      (Number.isFinite(Number(audit.websiteHealthScore))
        ? Number(audit.websiteHealthScore) + "/100"
        : "limited measurable data"),
    whyItMatters:
      "This diagnostic remains separate from the Marketing Opportunity Score but can inform human review and outreach.",
    evidence
  };
}

function normalizeFallback(parsed, { config, prospect, audit }) {
  const website = validUrl(prospect.website);
  const allowedCapabilities = new Set(config.capabilities.map((item) => item.id));

  const decisionMakers = [];
  for (const person of Array.isArray(parsed?.decisionMakers) ? parsed.decisionMakers : []) {
    const evidence = normalizeEvidence(person?.evidence, website);
    if (!text(person?.name) || !text(person?.title) || !evidence.length) continue;
    decisionMakers.push({
      name: text(person.name),
      title: text(person.title),
      roleCategory: roleCategory(person.roleCategory || person.title),
      professionalUrl: validUrl(person.professionalUrl),
      publicBusinessEmail: validEmail(person.publicBusinessEmail),
      confidence: clampConfidence(person.confidence, 60),
      evidence: evidence.slice(0, 5)
    });
    if (decisionMakers.length >= 8) break;
  }

  const contactPaths = [];
  for (const path of Array.isArray(parsed?.contactPaths) ? parsed.contactPaths : []) {
    const evidence = normalizeEvidence(path?.evidence, path?.url || website);
    const type = contactType(path?.type);
    const value = type === "email" ? validEmail(path?.value) : text(path?.value) || null;
    const url = validUrl(path?.url);
    if (!evidence.length || (!value && !url)) continue;
    contactPaths.push({
      type,
      label: text(path?.label, "Public business contact path"),
      value,
      url,
      evidence: evidence.slice(0, 3)
    });
    if (contactPaths.length >= 10) break;
  }

  const growthSignals = [];
  for (const signal of Array.isArray(parsed?.growthSignals) ? parsed.growthSignals : []) {
    const evidence = normalizeEvidence(signal?.evidence, website);
    if (!text(signal?.signal) || !text(signal?.whyItMatters) || !evidence.length) continue;
    growthSignals.push({
      signal: text(signal.signal),
      whyItMatters: text(signal.whyItMatters),
      evidence: evidence.slice(0, 4)
    });
    if (growthSignals.length >= 10) break;
  }

  const marketingSignals = [];
  for (const signal of Array.isArray(parsed?.marketingSignals) ? parsed.marketingSignals : []) {
    const evidence = normalizeEvidence(signal?.evidence, website);
    if (!text(signal?.finding) || !text(signal?.whyItMatters) || !evidence.length) continue;
    marketingSignals.push({
      area: marketingArea(signal?.area),
      type: marketingType(signal?.type),
      finding: text(signal.finding),
      whyItMatters: text(signal.whyItMatters),
      evidence: evidence.slice(0, 4)
    });
    if (marketingSignals.length >= 13) break;
  }

  const observation = auditObservation(audit);
  if (observation) marketingSignals.push(observation);

  const verifiedCapabilities = [...new Set(
    (Array.isArray(parsed?.verifiedCapabilities) ? parsed.verifiedCapabilities : [])
      .filter((item) => allowedCapabilities.has(item))
  )].slice(0, 24);

  const companySizeSignals = (Array.isArray(parsed?.companySizeSignals) ? parsed.companySizeSignals : [])
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, 8);

  return {
    industry: config.id,
    companyName: prospect.name,
    website,
    businessSummary: text(
      parsed?.businessSummary,
      "Public business and website information was reviewed, but the primary enrichment formatter could not produce a complete structured record."
    ),
    subindustry: text(parsed?.subindustry) || prospect.subindustry || null,
    serviceArea: text(parsed?.serviceArea) || null,
    companySizeSignals,
    verifiedCapabilities,
    decisionMakers,
    contactPaths,
    growthSignals,
    marketingSignals,
    opportunitySummary: text(
      parsed?.opportunitySummary,
      "Fallback enrichment completed with conservative evidence handling."
    ),
    enrichmentConfidence: Math.min(70, clampConfidence(parsed?.enrichmentConfidence, 55)),
    websiteAudit: compactAudit(audit),
    websiteAuditCached: false,
    websiteAuditError: null,
    enrichmentFallbackUsed: true
  };
}

function createFallbackAgent(config) {
  return new Agent({
    name: config.label + " Resilient Enrichment Fallback",
    model: fallbackModel,
    instructions: [
      "Research one already-discovered B2B company using public business information only.",
      "Return one JSON object only. No markdown.",
      "Never guess or construct email addresses, phone numbers, people, titles, services, or growth events.",
      "Every named person, contact path, growth signal, and marketing observation must include public evidence with URL and fact.",
      "If a field cannot be verified, use null or an empty array.",
      "For legal firms, partners, managing partners, shareholders, firm administrators, marketing leaders, and business-development leaders are acceptable business-role contacts when publicly supported.",
      "Use concise output and preserve exact public business emails only when explicitly published."
    ].join("\n"),
    tools: [webSearchTool({ searchContextSize: "medium" })],
    modelSettings: {
      reasoning: { effort: "low" },
      text: { verbosity: "low" }
    }
  });
}

async function fallbackEnrich({ industry, prospect, primaryError }) {
  const config = getIndustryConfig(industry);
  if (!config) throw primaryError;

  const agent = createFallbackAgent(config);
  const prompt = [
    "Company: " + prospect.name,
    "Website: " + prospect.website,
    "Location: " + [prospect.city, prospect.state].filter(Boolean).join(", "),
    "Known specialty: " + (prospect.subindustry || "unknown"),
    "Allowed capability IDs: " + config.capabilities.map((item) => item.id).join(", "),
    "",
    "Return JSON with keys:",
    "businessSummary, subindustry, serviceArea, companySizeSignals, verifiedCapabilities,",
    "decisionMakers, contactPaths, growthSignals, marketingSignals, opportunitySummary, enrichmentConfidence.",
    "",
    "decisionMakers items: name, title, roleCategory, professionalUrl, publicBusinessEmail, confidence, evidence[{url,fact}]",
    "contactPaths items: type, label, value, url, evidence[{url,fact}]",
    "growthSignals items: signal, whyItMatters, evidence[{url,fact}]",
    "marketingSignals items: area, type, finding, whyItMatters, evidence[{url,fact}]"
  ].join("\n");

  const [research, auditResult] = await Promise.allSettled([
    run(agent, prompt),
    getOrRunWebsiteAudit({ industry, prospect })
  ]);

  if (research.status === "rejected" || !research.value?.finalOutput) {
    const error = research.status === "rejected" ? research.reason : primaryError;
    error.agentStage = error.agentStage || "enrichment_fallback_research";
    throw error;
  }

  let parsed;
  try {
    parsed = parseLooseJson(research.value.finalOutput);
  } catch (error) {
    error.agentStage = "enrichment_fallback_json";
    throw error;
  }

  const audit = auditResult.status === "fulfilled"
    ? auditResult.value?.audit || null
    : null;

  return {
    ...normalizeFallback(parsed, { config, prospect, audit }),
    primaryEnrichmentError: safeError(primaryError),
    websiteAuditCached:
      auditResult.status === "fulfilled" && Boolean(auditResult.value?.cached),
    websiteAuditError:
      auditResult.status === "rejected"
        ? safeError(auditResult.reason)
        : auditResult.value?.persistenceError || null
  };
}

export async function enrichProspect(args) {
  try {
    return await enrichPrimary(args);
  } catch (primaryError) {
    console.warn(
      "Primary Agent 2 enrichment failed; attempting resilient fallback:",
      args?.prospect?.name,
      safeError(primaryError)
    );
    return fallbackEnrich({ ...args, primaryError });
  }
}
