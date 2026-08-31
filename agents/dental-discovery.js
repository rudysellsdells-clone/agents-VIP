import { Agent, run, webSearchTool } from "@openai/agents";
import { z } from "zod";

const Evidence = z.object({
  url: z.string().url(),
  fact: z.string().min(1)
});

const DentalProspect = z.object({
  name: z.string().min(1),
  website: z.string().url(),
  city: z.string().min(1),
  state: z.string().min(1),
  phone: z.string().nullable(),
  practiceType: z.enum(["independent", "small_group", "unknown"]),
  independenceConfidence: z.number().int().min(0).max(100),
  services: z.object({
    implants: z.boolean(),
    fullMouth: z.boolean(),
    cosmetic: z.boolean(),
    clearAligners: z.boolean(),
    sedation: z.boolean()
  }),
  discoveryConfidence: z.number().int().min(0).max(100),
  fitReasons: z.array(z.string().min(1)).min(1).max(6),
  evidence: z.array(Evidence).min(1).max(8)
});

const DentalDiscoveryOutput = z.object({
  market: z.string().min(1),
  radiusMiles: z.number().min(1).max(250),
  searchSummary: z.string().min(1),
  prospects: z.array(DentalProspect).max(25)
});

const researchModel =
  process.env.DISCOVERY_RESEARCH_MODEL ||
  process.env.DISCOVERY_MODEL ||
  "gpt-5.6-luna";

const formatModel =
  process.env.DISCOVERY_FORMAT_MODEL ||
  process.env.DISCOVERY_MODEL ||
  "gpt-5.6-luna";

const dentalResearchAgent = new Agent({
  name: "Dental Prospect Web Researcher",
  model: researchModel,
  instructions: `
You research B2B dental-practice candidates for a marketing agency.

Use public business information only. Do not find personal email addresses,
personal phone numbers, patient information, or sensitive personal information.

Your job is to perform web research and produce a concise research dossier that
a second agent can normalize into structured data.

Prioritize:
- independently owned practices and small local groups;
- practices serving the requested market;
- dental implants, full-mouth rehabilitation, cosmetic dentistry, clear
  aligners, and sedation dentistry;
- real first-party practice websites;
- enough evidence to verify material facts.

Deprioritize or exclude:
- national dental chains;
- obvious large DSOs or corporate groups;
- directories and lead-generation pages;
- duplicate locations;
- practices outside the requested geography;
- material facts that would require guessing.

For every candidate, include:
- practice name;
- canonical first-party website URL;
- city and state;
- public business phone if clearly published;
- likely practice type: independent, small local group, or unknown;
- evidence supporting ownership/practice type when available;
- which priority services are explicitly supported by evidence;
- 1-6 reasons the practice is worth carrying forward into discovery;
- source URLs paired with the specific fact each source supports.

Never invent a service, location, ownership structure, phone number, website,
or source URL. If a fact is uncertain, say so explicitly. Return fewer
candidates rather than weak or fabricated ones.
`,
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

const dentalFormatterAgent = new Agent({
  name: "Dental Prospect Research Formatter",
  model: formatModel,
  instructions: `
Convert the supplied dental-practice research dossier into the required
structured discovery output.

Do not do new web research and do not add facts that are absent from the
dossier. Preserve source URLs exactly when they are valid public HTTP/HTTPS
URLs. Omit weak candidates rather than inventing missing information.

Rules:
- discoveryConfidence is confidence that this is a valid, relevant discovery
  candidate, not a final sales opportunity score;
- independenceConfidence reflects only the evidence in the dossier;
- service booleans may be true only when the dossier contains evidence for that
  service;
- phone may be null;
- practiceType must be independent, small_group, or unknown;
- every retained prospect must have at least one evidence item;
- website must be the first-party practice website, not a directory or social
  profile.
`,
  outputType: DentalDiscoveryOutput,
  modelSettings: {
    reasoning: { effort: "low" },
    text: { verbosity: "low" }
  }
});

const SERVICE_LABELS = {
  implants: "dental implants",
  fullMouth: "full-mouth rehabilitation or reconstruction",
  cosmetic: "cosmetic dentistry",
  clearAligners: "clear aligners or Invisalign",
  sedation: "sedation dentistry"
};

const PRACTICE_TYPE_LABELS = {
  independent: "independent practices",
  small_group: "small local groups",
  unknown: "practices whose ownership is not yet clear"
};

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

function dedupeProspects(prospects, maxResults) {
  const seen = new Set();
  const unique = [];

  for (const prospect of prospects) {
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
    unique.push({
      ...prospect,
      website: normalizeWebsite(prospect.website)
    });

    if (unique.length >= maxResults) break;
  }

  return unique;
}

export async function discoverDentalProspects({
  market,
  radiusMiles = 50,
  maxResults = 15,
  priorities = [],
  practiceTypes = ["independent", "small_group"]
}) {
  const priorityText = priorities.length
    ? priorities
        .map((item) => SERVICE_LABELS[item])
        .filter(Boolean)
        .join(", ")
    : "dental implants, full-mouth rehabilitation, cosmetic dentistry, clear aligners, and sedation dentistry";

  const practiceTypeText = practiceTypes
    .map((item) => PRACTICE_TYPE_LABELS[item])
    .filter(Boolean)
    .join(" and ");

  const researchPrompt = `
Research up to ${maxResults} dental practices that are strong discovery
candidates within approximately ${radiusMiles} miles of ${market}.

Favor verified ${practiceTypeText || "independent or small-group practices"}.

The user's service priorities are:
${priorityText}.

Treat those service priorities as ranking preferences, not permission to invent
services. Use multiple web searches as needed. Verify first-party websites,
location, services, and evidence. Return fewer candidates if the public
evidence is insufficient.
`;

  const researchResult = await run(dentalResearchAgent, researchPrompt);

  if (!researchResult.finalOutput || typeof researchResult.finalOutput !== "string") {
    throw new Error("Dental web research returned no usable research dossier.");
  }

  const formatPrompt = `
Market: ${market}
Radius miles: ${radiusMiles}
Maximum prospects: ${maxResults}

Normalize the following web-research dossier into the structured discovery
schema. The output market must be "${market}" and radiusMiles must be
${radiusMiles}. Keep no more than ${maxResults} prospects.

--- BEGIN RESEARCH DOSSIER ---
${researchResult.finalOutput}
--- END RESEARCH DOSSIER ---
`;

  const formattedResult = await run(dentalFormatterAgent, formatPrompt);

  if (!formattedResult.finalOutput) {
    throw new Error("Dental formatter returned no structured output.");
  }

  return {
    ...formattedResult.finalOutput,
    market,
    radiusMiles,
    prospects: dedupeProspects(
      formattedResult.finalOutput.prospects,
      maxResults
    )
  };
}

export { DentalDiscoveryOutput };
