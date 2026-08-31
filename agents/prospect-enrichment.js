import { Agent, run, webSearchTool } from "@openai/agents";
import { z } from "zod";
import { getIndustryConfig } from "../config/industries.js";

const Evidence = z.object({
  url: z.string().url(),
  fact: z.string().min(1)
});

const DecisionMaker = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  roleCategory: z.enum([
    "owner",
    "executive",
    "marketing",
    "operations",
    "business_development",
    "other"
  ]),
  professionalUrl: z.string().url().nullable(),
  publicBusinessEmail: z.string().email().nullable(),
  confidence: z.number().int().min(0).max(100),
  evidence: z.array(Evidence).min(1).max(5)
});

const ContactPath = z.object({
  type: z.enum([
    "email",
    "phone",
    "contact_form",
    "linkedin_company",
    "linkedin_professional",
    "other"
  ]),
  label: z.string().min(1),
  value: z.string().nullable(),
  url: z.string().url().nullable(),
  evidence: z.array(Evidence).min(1).max(3)
});

const GrowthSignal = z.object({
  signal: z.string().min(1),
  whyItMatters: z.string().min(1),
  evidence: z.array(Evidence).min(1).max(4)
});

const MarketingSignal = z.object({
  area: z.enum([
    "website_ux",
    "seo_content",
    "conversion",
    "positioning",
    "reviews_reputation",
    "social",
    "paid_visibility",
    "ai_discovery",
    "competitive",
    "other"
  ]),
  type: z.enum(["strength", "opportunity", "unknown"]),
  finding: z.string().min(1),
  whyItMatters: z.string().min(1),
  evidence: z.array(Evidence).min(1).max(4)
});

const EnrichmentOutput = z.object({
  industry: z.string().min(1),
  companyName: z.string().min(1),
  website: z.string().url(),
  businessSummary: z.string().min(1),
  subindustry: z.string().nullable(),
  serviceArea: z.string().nullable(),
  companySizeSignals: z.array(z.string().min(1)).max(8),
  verifiedCapabilities: z.array(z.string()).max(24),
  decisionMakers: z.array(DecisionMaker).max(8),
  contactPaths: z.array(ContactPath).max(10),
  growthSignals: z.array(GrowthSignal).max(10),
  marketingSignals: z.array(MarketingSignal).max(14),
  opportunitySummary: z.string().min(1),
  enrichmentConfidence: z.number().int().min(0).max(100)
});

const researchModel =
  process.env.ENRICHMENT_RESEARCH_MODEL ||
  process.env.DISCOVERY_RESEARCH_MODEL ||
  process.env.DISCOVERY_MODEL ||
  "gpt-5.6-luna";

const formatModel =
  process.env.ENRICHMENT_FORMAT_MODEL ||
  process.env.DISCOVERY_FORMAT_MODEL ||
  process.env.DISCOVERY_MODEL ||
  "gpt-5.6-luna";

function createResearchAgent(config) {
  return new Agent({
    name: config.label + " Prospect Enrichment Researcher",
    model: researchModel,
    instructions: [
      "You perform evidence-based B2B company enrichment and marketing opportunity research.",
      "",
      "Industry: " + config.label + ".",
      "",
      "Use public business and professional information only.",
      "Do not collect sensitive personal information, private contact information,",
      "home addresses, personal phone numbers, client/patient information, or make",
      "sensitive inferences about individuals.",
      "",
      "Public professional decision-maker information is allowed when it is relevant",
      "to the person's business role. Public business email may be recorded only",
      "when the exact address is explicitly published by the business or professional.",
      "Never infer, construct, or pattern-generate an email address.",
      "",
      "Your goal is to enrich one already-discovered company, not to discover new",
      "companies and not to calculate a final sales score.",
      "",
      "Research the company's first-party website and credible public sources for:",
      "- business summary, specialties, service area, locations, and company-size signals;",
      "- verified capabilities or services;",
      "- owners, executives, marketing leaders, operations leaders, business-development",
      "  leaders, or other likely business decision-makers;",
      "- official business contact paths, including public email, main phone, contact",
      "  forms, company LinkedIn, or clearly public professional profiles;",
      "- growth signals such as hiring, expansion, new offices, new equipment,",
      "  certifications, new services, acquisitions, additional crews/shifts, or",
      "  other evidence of investment and growth;",
      "- marketing strengths and marketing opportunities across website UX, SEO/content,",
      "  conversion paths, positioning, reviews/reputation, social visibility, paid",
      "  visibility, AI/LLM discoverability, and competitive presentation;",
      "- evidence explaining why each material finding matters commercially.",
      "",
      "Industry guidance:",
      ...config.researchGuidance.map((item) => "- " + item),
      "",
      "Be conservative. Never invent a person, title, email, marketing weakness,",
      "growth event, capability, or source. If something cannot be verified, omit it",
      "or explicitly mark uncertainty in the research dossier."
    ].join("\n"),
    tools: [
      webSearchTool({
        searchContextSize: "medium"
      })
    ],
    modelSettings: {
      reasoning: { effort: "low" },
      text: { verbosity: "low" }
    }
  });
}

const formatterAgent = new Agent({
  name: "Prospect Enrichment Formatter",
  model: formatModel,
  instructions: [
    "Convert the supplied company enrichment dossier into JSON only.",
    "Do not perform new research and do not add facts absent from the dossier.",
    "Return exactly one JSON object, with no markdown fences or commentary.",
    "",
    "Every decision-maker, growth signal, marketing signal, and contact path must",
    "be supported by at least one evidence item.",
    "Use null when optional information is unavailable.",
    "Public business emails must appear exactly as supported by the dossier.",
    "Never infer or construct an email address.",
    "professionalUrl must be a public professional or business profile URL when present.",
    "verifiedCapabilities must use only the capability IDs supplied in the request.",
    "Marketing signals are observations, not a final score.",
    "enrichmentConfidence is confidence in the completeness and reliability of this",
    "enrichment result, not sales propensity."
  ].join("\n"),
  modelSettings: {
    reasoning: { effort: "low" },
    text: { verbosity: "low" }
  }
});

function parseJson(value) {
  if (typeof value !== "string") {
    throw new Error("Enrichment formatter did not return text.");
  }

  const unfenced = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed;

  try {
    parsed = JSON.parse(unfenced);
  } catch {
    const firstBrace = unfenced.indexOf("{");
    const lastBrace = unfenced.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Enrichment formatter returned invalid JSON.");
    }

    parsed = JSON.parse(unfenced.slice(firstBrace, lastBrace + 1));
  }

  const validated = EnrichmentOutput.safeParse(parsed);

  if (!validated.success) {
    const details = validated.error.issues
      .slice(0, 10)
      .map((issue) => (issue.path.join(".") || "root") + ": " + issue.message)
      .join("; ");

    throw new Error("Enrichment JSON failed local validation: " + details);
  }

  return validated.data;
}

function normalizeWebsite(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

async function formatEnrichment({
  config,
  prospect,
  dossier
}) {
  const allowedCapabilityIds = config.capabilities.map((item) => item.id);

  const shape = {
    industry: config.id,
    companyName: prospect.name,
    website: prospect.website,
    businessSummary: "Evidence-based summary of the company.",
    subindustry: prospect.subindustry || null,
    serviceArea: null,
    companySizeSignals: ["Publicly supported size or operating signal"],
    verifiedCapabilities: allowedCapabilityIds.slice(0, 2),
    decisionMakers: [
      {
        name: "Publicly verified decision-maker",
        title: "Owner",
        roleCategory: "owner",
        professionalUrl: null,
        publicBusinessEmail: null,
        confidence: 85,
        evidence: [
          {
            url: "https://source.example/team",
            fact: "Source supports the person's business role."
          }
        ]
      }
    ],
    contactPaths: [
      {
        type: "contact_form",
        label: "Company contact form",
        value: null,
        url: prospect.website,
        evidence: [
          {
            url: prospect.website,
            fact: "First-party business contact path."
          }
        ]
      }
    ],
    growthSignals: [
      {
        signal: "Publicly verified growth signal",
        whyItMatters: "Commercial significance of the signal.",
        evidence: [
          {
            url: "https://source.example/news",
            fact: "Source supports the growth signal."
          }
        ]
      }
    ],
    marketingSignals: [
      {
        area: "website_ux",
        type: "opportunity",
        finding: "Evidence-based marketing observation.",
        whyItMatters: "Why this could matter to the business.",
        evidence: [
          {
            url: prospect.website,
            fact: "Source supports the observation."
          }
        ]
      }
    ],
    opportunitySummary:
      "Concise evidence-based summary of why this company deserves further evaluation.",
    enrichmentConfidence: 80
  };

  const basePrompt = [
    "Industry ID: " + config.id,
    "Company name: " + prospect.name,
    "Canonical website: " + prospect.website,
    "Known city/state: " + [prospect.city, prospect.state].filter(Boolean).join(", "),
    "Known subindustry: " + (prospect.subindustry || "unknown"),
    "Known public business email: " + (prospect.email || "none"),
    "Known public business phone: " + (prospect.phone || "none"),
    "",
    "Allowed capability IDs:",
    allowedCapabilityIds.join(", "),
    "",
    "Required JSON shape example:",
    JSON.stringify(shape, null, 2),
    "",
    "The output industry must be " + JSON.stringify(config.id) + ".",
    "The output companyName must identify the same company supplied above.",
    "The output website must use the same first-party company domain.",
    "",
    "--- BEGIN ENRICHMENT DOSSIER ---",
    dossier,
    "--- END ENRICHMENT DOSSIER ---"
  ].join("\n");

  let previousOutput = "";
  let previousError = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : [
            basePrompt,
            "",
            "--- FORMAT REPAIR ---",
            "The previous JSON did not pass local validation.",
            "Validation error: " + previousError,
            "Previous output:",
            previousOutput,
            "Return corrected JSON only."
          ].join("\n");

    let result;

    try {
      result = await run(formatterAgent, prompt);
    } catch (error) {
      error.agentStage = "enrichment_formatter";
      throw error;
    }

    if (!result.finalOutput) {
      const error = new Error("Enrichment formatter returned no output.");
      error.agentStage = "enrichment_formatter";
      throw error;
    }

    previousOutput = result.finalOutput;

    try {
      return parseJson(result.finalOutput);
    } catch (error) {
      previousError = error.message;

      if (attempt === 2) {
        error.agentStage = "enrichment_json_validation";
        throw error;
      }
    }
  }

  throw new Error("Enrichment formatter failed unexpectedly.");
}

export async function enrichProspect({ industry, prospect }) {
  const config = getIndustryConfig(industry);

  if (!config) {
    throw new Error("Unsupported industry: " + industry);
  }

  if (!prospect?.name || !prospect?.website) {
    throw new Error("Prospect name and website are required for enrichment.");
  }

  const normalizedWebsite = normalizeWebsite(prospect.website);
  const researchAgent = createResearchAgent(config);

  const prompt = [
    "Deeply enrich this already-discovered B2B prospect:",
    "",
    "Company: " + prospect.name,
    "Website: " + normalizedWebsite,
    "Location: " + [prospect.city, prospect.state].filter(Boolean).join(", "),
    "Known specialty: " + (prospect.subindustry || "unknown"),
    "Known capabilities: " + (prospect.capabilities || []).join(", "),
    "",
    "Start with the company's first-party website, then use credible public sources",
    "to verify leadership, business contact paths, growth signals, and marketing",
    "strengths/opportunities. Focus on information that helps determine whether this",
    "company deserves deeper sales attention.",
    "",
    "Do not calculate a final sales score. Do not invent missing facts."
  ].join("\n");

  let researchResult;

  try {
    researchResult = await run(researchAgent, prompt);
  } catch (error) {
    error.agentStage = "enrichment_web_research";
    throw error;
  }

  if (!researchResult.finalOutput || typeof researchResult.finalOutput !== "string") {
    const error = new Error("Enrichment web research returned no usable dossier.");
    error.agentStage = "enrichment_web_research";
    throw error;
  }

  const formatted = await formatEnrichment({
    config,
    prospect: {
      ...prospect,
      website: normalizedWebsite
    },
    dossier: researchResult.finalOutput
  });

  const allowedCapabilities = new Set(
    config.capabilities.map((item) => item.id)
  );

  return {
    ...formatted,
    industry: config.id,
    companyName: prospect.name,
    website: normalizedWebsite,
    verifiedCapabilities: [...new Set(
      formatted.verifiedCapabilities.filter((item) =>
        allowedCapabilities.has(item)
      )
    )]
  };
}

export { EnrichmentOutput };
