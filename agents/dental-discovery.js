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

const dentalDiscoveryAgent = new Agent({
  name: "Dental Prospect Discovery",
  model: process.env.DISCOVERY_MODEL || "gpt-5.4-mini",
  instructions: `
You identify strong B2B dental-practice candidates for a marketing agency.

Your only job is discovery. Do not find personal email addresses, personal phone
numbers, patient information, or sensitive personal information. Use public
business information only.

Prioritize:
- independently owned practices and small local groups;
- practices that appear to serve the requested market;
- practices offering commercially attractive services such as dental implants,
  full-mouth rehabilitation, cosmetic dentistry, clear aligners, or sedation;
- practices with a real first-party website and enough public evidence to
  support the result.

Deprioritize or exclude:
- national dental chains;
- obvious large DSOs or corporate groups;
- directories, lead-generation pages, duplicate locations, and businesses that
  cannot be verified from credible public sources;
- practices outside the requested geography;
- prospects for which you would need to guess material facts.

Research broadly with web search. Verify each candidate using first-party
practice pages when possible and supplement them with credible public sources.
Never invent a service, ownership structure, location, phone number, or URL.

The discoveryConfidence field means confidence that the business is a valid,
relevant discovery candidate. It is NOT a sales opportunity score.

The independenceConfidence field means confidence, based only on public
evidence, that the practice is independently owned or a small local group.

Every prospect must include evidence URLs and concise facts that support why it
was included. If evidence is weak, lower confidence or omit the prospect.
`,
  tools: [
    webSearchTool({
      searchContextSize: "medium"
    })
  ],
  outputType: DentalDiscoveryOutput
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

  const input = `
Find up to ${maxResults} dental practices that are strong discovery candidates
within approximately ${radiusMiles} miles of ${market}.

This is the first stage of a B2B prospecting pipeline. Favor verified
${practiceTypeText || "independent or small-group practices"}.

The user especially wants practices relevant to these service priorities:
${priorityText}.

Treat those service priorities as ranking preferences, not permission to invent
services. A practice may still be useful if it has other strong high-value
services, but rank matches higher when the evidence is comparable.

Do not force the count: return fewer prospects if the public evidence is
insufficient.

For each practice, verify its real website, city/state, relevant services, and
why it belongs in the discovery pool. Use multiple searches as needed and cite
the public evidence in the structured output.
`;

  const result = await run(dentalDiscoveryAgent, input);

  if (!result.finalOutput) {
    throw new Error("Dental discovery agent returned no structured output.");
  }

  return {
    ...result.finalOutput,
    market,
    radiusMiles,
    prospects: dedupeProspects(result.finalOutput.prospects, maxResults)
  };
}

export { DentalDiscoveryOutput };
