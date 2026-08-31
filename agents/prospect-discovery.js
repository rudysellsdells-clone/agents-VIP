import { Agent, run, webSearchTool } from "@openai/agents";
import { z } from "zod";
import {
  COMPANY_TYPE_IDS,
  getIndustryConfig
} from "../config/industries.js";

const Evidence = z.object({
  url: z.string().url(),
  fact: z.string().min(1)
});

const Prospect = z.object({
  name: z.string().min(1),
  website: z.string().url(),
  city: z.string().min(1),
  state: z.string().min(1),
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
  subindustry: z.string().nullable(),
  companyType: z.enum(["independent", "small_group", "regional", "unknown"]),
  companyTypeConfidence: z.number().int().min(0).max(100),
  capabilities: z.array(z.string()).max(24),
  discoveryConfidence: z.number().int().min(0).max(100),
  fitReasons: z.array(z.string().min(1)).min(1).max(6),
  evidence: z.array(Evidence).min(1).max(8)
});

const ProspectDiscoveryOutput = z.object({
  industry: z.string().min(1),
  market: z.string().min(1),
  radiusMiles: z.number().min(1).max(250),
  searchSummary: z.string().min(1),
  prospects: z.array(Prospect).max(25)
});

const researchModel =
  process.env.DISCOVERY_RESEARCH_MODEL ||
  process.env.DISCOVERY_MODEL ||
  "gpt-5.6-luna";

const formatModel =
  process.env.DISCOVERY_FORMAT_MODEL ||
  process.env.DISCOVERY_MODEL ||
  "gpt-5.6-luna";

function optionList(options) {
  return options.map((item) => item.id + " = " + item.label).join("\n");
}

function createResearchAgent(config) {
  return new Agent({
    name: config.label + " Prospect Web Researcher",
    model: researchModel,
    instructions: [
      "You research B2B prospect candidates for a marketing and growth consultancy.",
      "",
      "Industry: " + config.label + ".",
      "Target business type: " + config.pluralNoun + ".",
      "",
      "Use public business information only. Do not collect sensitive personal",
      "information, private contact details, client/patient information, or make",
      "sensitive inferences about individuals.",
      "",
      "Your job is to perform web research and produce a concise evidence dossier",
      "that a second agent can normalize into JSON.",
      "",
      "Industry guidance:",
      ...config.researchGuidance.map((item) => "- " + item),
      "",
      "For every candidate, include:",
      "- company or firm name;",
      "- canonical first-party website URL;",
      "- city and state;",
      "- public main business phone if clearly published;",
      "- public business email if clearly published by the business; prefer a",
      "  general business inbox when available, but a named professional email",
      "  may be used if the business itself publishes it for business contact;",
      "- best-fit subindustry or specialty;",
      "- likely company type: independent, small_group, regional, or unknown;",
      "- evidence supporting company type when available;",
      "- capabilities that are explicitly supported by evidence;",
      "- 1-6 reasons the business is worth carrying forward;",
      "- source URLs paired with the specific fact each source supports.",
      "",
      "Never invent capabilities, location, ownership, phone, email, website, or sources.",
      "Never guess or derive an email from a person's name, domain pattern, or other",
      "employees' addresses. If no email is explicitly published, record it as unavailable.",
      "Return fewer candidates rather than weak or fabricated ones."
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
  name: "Universal Prospect Research Formatter",
  model: formatModel,
  instructions: [
    "Convert the supplied public-business research dossier into JSON only.",
    "Do not do new web research and do not add facts absent from the dossier.",
    "Preserve valid source URLs exactly. Omit weak candidates rather than inventing",
    "missing information.",
    "",
    "Return exactly one JSON object. No markdown fences and no commentary.",
    "Use only the capability IDs and company-type IDs supplied in the request.",
    "Phone may be null. Email may be null. subindustry may be null.",
    "Email must be an exact publicly published business-contact email from the",
    "research dossier. Never infer or construct an email address.",
    "Every retained prospect must have at least one evidence item.",
    "The website must be the first-party business website, not a directory or",
    "social profile.",
    "discoveryConfidence means confidence that the company is a valid relevant",
    "discovery candidate; it is not a final sales opportunity score.",
    "companyTypeConfidence must reflect only evidence in the dossier."
  ].join("\n"),
  modelSettings: {
    reasoning: { effort: "low" },
    text: { verbosity: "low" }
  }
});

function parseFormatterJson(value) {
  if (typeof value !== "string") {
    throw new Error("Prospect formatter did not return text.");
  }

  const trimmed = value.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed;

  try {
    parsed = JSON.parse(unfenced);
  } catch {
    const firstBrace = unfenced.indexOf("{");
    const lastBrace = unfenced.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Prospect formatter returned invalid JSON.");
    }

    parsed = JSON.parse(unfenced.slice(firstBrace, lastBrace + 1));
  }

  const validated = ProspectDiscoveryOutput.safeParse(parsed);

  if (!validated.success) {
    const details = validated.error.issues
      .slice(0, 8)
      .map((issue) => (issue.path.join(".") || "root") + ": " + issue.message)
      .join("; ");

    throw new Error("Prospect formatter JSON failed local validation: " + details);
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

function normalizeOutput(output, config, maxResults) {
  const allowedCapabilities = new Set(
    config.capabilities.map((item) => item.id)
  );
  const seen = new Set();
  const prospects = [];

  for (const prospect of output.prospects) {
    let key;

    try {
      key = new URL(prospect.website).hostname
        .toLowerCase()
        .replace(/^www\./, "");
    } catch {
      key = prospect.website.toLowerCase();
    }

    if (seen.has(key)) continue;
    seen.add(key);

    prospects.push({
      ...prospect,
      website: normalizeWebsite(prospect.website),
      capabilities: [...new Set(
        prospect.capabilities.filter((item) => allowedCapabilities.has(item))
      )]
    });

    if (prospects.length >= maxResults) break;
  }

  return prospects;
}

async function formatResearch({
  config,
  market,
  radiusMiles,
  maxResults,
  dossier
}) {
  const shape = {
    industry: config.id,
    market,
    radiusMiles,
    searchSummary: "Short summary of the search and strongest patterns.",
    prospects: [
      {
        name: "Business name",
        website: "https://first-party-site.example",
        city: "City",
        state: "ST",
        phone: null,
        email: null,
        subindustry: "Best supported specialty or null",
        companyType: "independent",
        companyTypeConfidence: 80,
        capabilities: [config.capabilities[0]?.id || "capabilityId"],
        discoveryConfidence: 85,
        fitReasons: ["Evidence-backed reason"],
        evidence: [
          {
            url: "https://source.example/page",
            fact: "Specific fact supported by this source."
          }
        ]
      }
    ]
  };

  const basePrompt = [
    "Industry ID: " + config.id,
    "Market: " + market,
    "Radius miles: " + radiusMiles,
    "Maximum prospects: " + maxResults,
    "",
    "Allowed companyType IDs:",
    optionList(config.companyTypes),
    "",
    "Allowed capability IDs:",
    optionList(config.capabilities),
    "",
    "Required JSON shape example:",
    JSON.stringify(shape, null, 2),
    "",
    "Normalize the research dossier below. Keep no more than " + maxResults + " prospects.",
    "The output industry must be " + JSON.stringify(config.id) + ".",
    "The output market must be " + JSON.stringify(market) + ".",
    "The output radiusMiles must be " + radiusMiles + ".",
    "",
    "--- BEGIN RESEARCH DOSSIER ---",
    dossier,
    "--- END RESEARCH DOSSIER ---"
  ].join("\n");

  let previousOutput = "";
  let previousError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : [
            basePrompt,
            "",
            "--- FORMAT REPAIR ---",
            "Your previous JSON did not pass local validation.",
            "Validation error: " + previousError,
            "Previous output:",
            previousOutput,
            "Return a corrected JSON object only."
          ].join("\n");

    let result;

    try {
      result = await run(formatterAgent, prompt);
    } catch (error) {
      error.agentStage = "formatter";
      throw error;
    }

    if (!result.finalOutput) {
      const error = new Error("Prospect formatter returned no output.");
      error.agentStage = "formatter";
      throw error;
    }

    previousOutput = result.finalOutput;

    try {
      return parseFormatterJson(result.finalOutput);
    } catch (error) {
      previousError = error.message;

      if (attempt === 2) {
        error.agentStage = "local_json_validation";
        throw error;
      }
    }
  }

  throw new Error("Prospect formatter failed unexpectedly.");
}

export async function discoverProspects({
  industry,
  market,
  radiusMiles = 25,
  maxResults = 5,
  priorities = [],
  companyTypes = ["independent", "small_group"]
}) {
  const config = getIndustryConfig(industry);

  if (!config) {
    throw new Error("Unsupported industry: " + industry);
  }

  const allowedCapabilityIds = new Set(
    config.capabilities.map((item) => item.id)
  );
  const allowedCompanyTypes = new Set(COMPANY_TYPE_IDS);

  const selectedPriorities = priorities.filter((item) =>
    allowedCapabilityIds.has(item)
  );

  const selectedCompanyTypes = companyTypes.filter((item) =>
    allowedCompanyTypes.has(item)
  );

  const priorityLabels = (
    selectedPriorities.length
      ? selectedPriorities
      : config.defaultPriorities
  )
    .map((id) => config.capabilities.find((item) => item.id === id)?.label)
    .filter(Boolean);

  const typeLabels = (
    selectedCompanyTypes.length
      ? selectedCompanyTypes
      : ["independent", "small_group"]
  )
    .map((id) => config.companyTypes.find((item) => item.id === id)?.label)
    .filter(Boolean);

  const researchPrompt = [
    "Research up to " + maxResults + " strong " + config.pluralNoun,
    "within approximately " + radiusMiles + " miles of " + market + ".",
    "",
    "Preferred company types: " + typeLabels.join(", ") + ".",
    "Priority capabilities or specialties: " + priorityLabels.join(", ") + ".",
    "",
    "Treat priorities as ranking preferences, never as permission to invent",
    "capabilities. Use multiple searches as needed. Verify first-party websites,",
    "location, specialties/capabilities, and public evidence. Return fewer",
    "candidates if the evidence is insufficient."
  ].join("\n");

  const researchAgent = createResearchAgent(config);
  let researchResult;

  try {
    researchResult = await run(researchAgent, researchPrompt);
  } catch (error) {
    error.agentStage = "web_research";
    throw error;
  }

  if (!researchResult.finalOutput || typeof researchResult.finalOutput !== "string") {
    const error = new Error("Web research returned no usable dossier.");
    error.agentStage = "web_research";
    throw error;
  }

  const formatted = await formatResearch({
    config,
    market,
    radiusMiles,
    maxResults,
    dossier: researchResult.finalOutput
  });

  return {
    ...formatted,
    industry: config.id,
    market,
    radiusMiles,
    prospects: normalizeOutput(formatted, config, maxResults)
  };
}

export { ProspectDiscoveryOutput };
