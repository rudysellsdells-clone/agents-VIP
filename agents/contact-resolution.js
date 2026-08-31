import { Agent, run, webSearchTool } from "@openai/agents";
import { z } from "zod";
import { getIndustryConfig } from "../config/industries.js";

const Evidence = z.object({
  url: z.string().url(),
  fact: z.string().min(1)
});

const ResolvedDecisionMaker = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  roleCategory: z.enum([
    "owner",
    "executive",
    "marketing",
    "operations",
    "business_development",
    "sales",
    "office_management",
    "other"
  ]),
  whyThisPerson: z.string().min(1),
  publicBusinessEmail: z.string().email().nullable(),
  publicBusinessPhone: z.string().nullable(),
  professionalUrl: z.string().url().nullable(),
  confidence: z.number().int().min(0).max(100),
  evidence: z.array(Evidence).min(1).max(6)
});

const ResolvedContactPath = z.object({
  type: z.enum([
    "email",
    "phone",
    "contact_form",
    "linkedin_professional",
    "linkedin_company",
    "website",
    "other"
  ]),
  label: z.string().min(1),
  value: z.string().nullable(),
  url: z.string().url().nullable(),
  confidence: z.number().int().min(0).max(100),
  evidence: z.array(Evidence).min(1).max(4)
});

const OutreachAngle = z.object({
  angle: z.string().min(1),
  evidenceBasis: z.array(z.string().min(1)).min(1).max(6),
  recommendedChannel: z.enum([
    "email",
    "phone",
    "linkedin",
    "contact_form",
    "multi_channel"
  ]),
  reasonForChannel: z.string().min(1),
  avoidClaims: z.array(z.string().min(1)).max(6)
});

const ContactResolutionOutput = z.object({
  industry: z.string().min(1),
  companyName: z.string().min(1),
  website: z.string().url(),
  marketingOpportunityScore: z.number().min(0).max(100),
  primaryDecisionMaker: ResolvedDecisionMaker.nullable(),
  secondaryDecisionMakers: z.array(ResolvedDecisionMaker).max(5),
  contactPaths: z.array(ResolvedContactPath).max(12),
  outreachAngle: OutreachAngle,
  resolutionSummary: z.string().min(1),
  resolutionConfidence: z.number().int().min(0).max(100)
});

const researchModel =
  process.env.CONTACT_RESEARCH_MODEL ||
  process.env.ENRICHMENT_RESEARCH_MODEL ||
  process.env.DISCOVERY_RESEARCH_MODEL ||
  process.env.DISCOVERY_MODEL ||
  "gpt-5.6-luna";

const formatModel =
  process.env.CONTACT_FORMAT_MODEL ||
  process.env.ENRICHMENT_FORMAT_MODEL ||
  process.env.DISCOVERY_FORMAT_MODEL ||
  process.env.DISCOVERY_MODEL ||
  "gpt-5.6-luna";

function createResearchAgent(config) {
  return new Agent({
    name: config.label + " Deep Contact Resolution Researcher",
    model: researchModel,
    instructions: [
      "You resolve the best legitimate B2B decision-maker and contact path for one",
      "already-qualified company.",
      "",
      "Industry: " + config.label + ".",
      "",
      "Use public business and professional information only.",
      "Do not collect home addresses, personal phone numbers, private email",
      "addresses, sensitive personal information, client/patient information, or",
      "make sensitive inferences about individuals.",
      "",
      "A named professional may be researched only in relation to their public",
      "business role. Public business email and business phone may be returned only",
      "when the exact contact information is explicitly published by the company,",
      "the professional, or another credible public business source.",
      "",
      "Never infer or generate an email address from a person's name, company domain,",
      "email pattern, or another employee's address. Never guess a phone number.",
      "",
      "The company has already passed discovery, enrichment, and deterministic",
      "opportunity scoring. Your job is not to re-score it and not to write outreach",
      "copy. Your job is to identify and rank the people and public contact routes",
      "most relevant to a business-development conversation.",
      "",
      "Prioritize people who plausibly own or influence marketing, growth, sales,",
      "operations, or vendor decisions. Rank by role relevance, evidence quality,",
      "and verified contactability.",
      "",
      "Use the supplied Agent 2 decision-makers as leads, but independently verify",
      "them. Search the first-party website first, then credible professional and",
      "business sources as needed.",
      "",
      "For the outreach angle, identify one evidence-based business issue or growth",
      "opportunity that would make a relevant opening conversation. Do not make",
      "accusations, diagnose failures you cannot prove, or create sales copy.",
      "",
      "Return fewer people rather than weak or invented contacts."
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
  name: "Deep Contact Resolution Formatter",
  model: formatModel,
  instructions: [
    "Convert the supplied contact-resolution dossier into JSON only.",
    "Do not perform new research and do not add facts absent from the dossier.",
    "Return exactly one JSON object, with no markdown fences or commentary.",
    "",
    "Every named person and every contact path must have evidence.",
    "Use null when direct contact information cannot be verified.",
    "Never infer or construct an email address or phone number.",
    "The primary decision-maker should be the strongest verified business contact,",
    "not merely the highest-ranking person.",
    "Secondary decision-makers should be genuinely plausible alternatives.",
    "The outreach angle must be grounded in supplied Agent 1-3 evidence and the",
    "research dossier. It is strategic direction, not outreach copy.",
    "resolutionConfidence is confidence in the contact-resolution result, not the",
    "company's opportunity score."
  ].join("\n"),
  modelSettings: {
    reasoning: { effort: "low" },
    text: { verbosity: "low" }
  }
});

function parseJson(value) {
  if (typeof value !== "string") {
    throw new Error("Contact formatter did not return text.");
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
      throw new Error("Contact formatter returned invalid JSON.");
    }

    parsed = JSON.parse(unfenced.slice(firstBrace, lastBrace + 1));
  }

  const validated = ContactResolutionOutput.safeParse(parsed);

  if (!validated.success) {
    const details = validated.error.issues
      .slice(0, 10)
      .map((issue) => (issue.path.join(".") || "root") + ": " + issue.message)
      .join("; ");

    throw new Error("Contact-resolution JSON failed local validation: " + details);
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

function compactEvidence(item) {
  return {
    url: item.url,
    fact: item.fact
  };
}

function compactAgentContext(prospect, enrichment, scoring) {
  return {
    prospect: {
      name: prospect.name,
      website: prospect.website,
      city: prospect.city || null,
      state: prospect.state || null,
      subindustry: prospect.subindustry || null,
      companyType: prospect.companyType || null,
      publicBusinessEmail: prospect.email || null,
      publicBusinessPhone: prospect.phone || null,
      verifiedCapabilities: prospect.capabilities || [],
      fitReasons: prospect.fitReasons || []
    },
    enrichment: {
      businessSummary: enrichment.businessSummary || "",
      serviceArea: enrichment.serviceArea || null,
      decisionMakers: (enrichment.decisionMakers || []).map((person) => ({
        name: person.name,
        title: person.title,
        roleCategory: person.roleCategory,
        professionalUrl: person.professionalUrl || null,
        publicBusinessEmail: person.publicBusinessEmail || null,
        confidence: person.confidence,
        evidence: (person.evidence || []).slice(0, 3).map(compactEvidence)
      })),
      contactPaths: (enrichment.contactPaths || []).map((path) => ({
        type: path.type,
        label: path.label,
        value: path.value || null,
        url: path.url || null,
        evidence: (path.evidence || []).slice(0, 2).map(compactEvidence)
      })),
      growthSignals: (enrichment.growthSignals || []).map((signal) => ({
        signal: signal.signal,
        whyItMatters: signal.whyItMatters
      })),
      marketingOpportunities: (enrichment.marketingSignals || [])
        .filter((signal) => signal.type === "opportunity")
        .map((signal) => ({
          area: signal.area,
          finding: signal.finding,
          whyItMatters: signal.whyItMatters
        })),
      opportunitySummary: enrichment.opportunitySummary || ""
    },
    scoring: {
      marketingOpportunityScore: scoring.marketingOpportunityScore,
      tier: scoring.tier,
      nextAction: scoring.nextAction,
      breakdown: Object.fromEntries(
        Object.entries(scoring.breakdown || {}).map(([key, category]) => [
          key,
          {
            score: category.score,
            max: category.max,
            reasons: category.reasons || []
          }
        ])
      )
    }
  };
}

async function formatResolution({
  config,
  prospect,
  scoring,
  dossier
}) {
  const shape = {
    industry: config.id,
    companyName: prospect.name,
    website: prospect.website,
    marketingOpportunityScore: scoring.marketingOpportunityScore,
    primaryDecisionMaker: {
      name: "Verified business decision-maker",
      title: "Owner",
      roleCategory: "owner",
      whyThisPerson: "Why this person is the strongest relevant contact.",
      publicBusinessEmail: null,
      publicBusinessPhone: null,
      professionalUrl: null,
      confidence: 90,
      evidence: [
        {
          url: "https://example.com/team",
          fact: "Source verifies the person's business role."
        }
      ]
    },
    secondaryDecisionMakers: [],
    contactPaths: [
      {
        type: "contact_form",
        label: "Company contact form",
        value: null,
        url: prospect.website,
        confidence: 90,
        evidence: [
          {
            url: prospect.website,
            fact: "First-party business contact route."
          }
        ]
      }
    ],
    outreachAngle: {
      angle: "Evidence-based business issue or growth opportunity.",
      evidenceBasis: ["Specific supported reason this angle is relevant."],
      recommendedChannel: "email",
      reasonForChannel: "Why this verified channel is appropriate.",
      avoidClaims: ["Any unsupported or overly aggressive claim to avoid."]
    },
    resolutionSummary: "Concise summary of the resolved contact strategy.",
    resolutionConfidence: 85
  };

  const basePrompt = [
    "Industry ID: " + config.id,
    "Company: " + prospect.name,
    "Website: " + prospect.website,
    "Marketing Opportunity Score: " + scoring.marketingOpportunityScore,
    "",
    "Required JSON shape example:",
    JSON.stringify(shape, null, 2),
    "",
    "The output must identify the same company and score supplied above.",
    "Prefer one excellent primary contact over several weak contacts.",
    "",
    "--- BEGIN CONTACT-RESOLUTION DOSSIER ---",
    dossier,
    "--- END CONTACT-RESOLUTION DOSSIER ---"
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
      error.agentStage = "contact_formatter";
      throw error;
    }

    if (!result.finalOutput) {
      const error = new Error("Contact formatter returned no output.");
      error.agentStage = "contact_formatter";
      throw error;
    }

    previousOutput = result.finalOutput;

    try {
      return parseJson(result.finalOutput);
    } catch (error) {
      previousError = error.message;

      if (attempt === 2) {
        error.agentStage = "contact_json_validation";
        throw error;
      }
    }
  }

  throw new Error("Contact formatter failed unexpectedly.");
}

export async function resolveProspectContact({
  industry,
  prospect,
  enrichment,
  scoring
}) {
  const config = getIndustryConfig(industry);

  if (!config) {
    throw new Error("Unsupported industry: " + industry);
  }

  if (!prospect?.name || !prospect?.website) {
    throw new Error("Prospect name and website are required.");
  }

  if (!enrichment || !scoring) {
    throw new Error("Agent 2 enrichment and Agent 3 scoring are required.");
  }

  const normalizedWebsite = normalizeWebsite(prospect.website);
  const context = compactAgentContext(
    { ...prospect, website: normalizedWebsite },
    enrichment,
    scoring
  );

  const researchAgent = createResearchAgent(config);

  const prompt = [
    "Resolve the strongest legitimate B2B decision-maker and contact route for:",
    "",
    "Company: " + prospect.name,
    "Website: " + normalizedWebsite,
    "Marketing Opportunity Score: " + scoring.marketingOpportunityScore,
    "Score Tier: " + scoring.tier,
    "",
    "Agents 1-3 context:",
    JSON.stringify(context, null, 2),
    "",
    "Verify the strongest existing decision-maker leads and search for better",
    "business-role contacts if warranted. Focus on people who can plausibly own or",
    "influence marketing, growth, sales, operations, or external vendor decisions.",
    "",
    "Verify public business email, business phone, contact forms, and professional",
    "profile URLs where available. Do not guess missing contact information.",
    "",
    "Finally identify one evidence-based outreach angle and the best verified",
    "channel. Do not write an email, call script, or social message."
  ].join("\n");

  let researchResult;

  try {
    researchResult = await run(researchAgent, prompt);
  } catch (error) {
    error.agentStage = "contact_web_research";
    throw error;
  }

  if (!researchResult.finalOutput || typeof researchResult.finalOutput !== "string") {
    const error = new Error("Contact-resolution research returned no usable dossier.");
    error.agentStage = "contact_web_research";
    throw error;
  }

  const formatted = await formatResolution({
    config,
    prospect: {
      ...prospect,
      website: normalizedWebsite
    },
    scoring,
    dossier: researchResult.finalOutput
  });

  return {
    ...formatted,
    industry: config.id,
    companyName: prospect.name,
    website: normalizedWebsite,
    marketingOpportunityScore: scoring.marketingOpportunityScore
  };
}

export { ContactResolutionOutput };
