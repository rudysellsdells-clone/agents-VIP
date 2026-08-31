import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { getIndustryConfig } from "../config/industries.js";

const EvidenceUse = z.object({
  claim: z.string().min(1),
  sourceContext: z.string().min(1)
});

const EmailDraft = z.object({
  subject: z.string().min(1).max(140),
  body: z.string().min(1).max(5000)
});

const PersuasionFramework = z.object({
  primary: z.enum([
    "fomo",
    "loss_aversion",
    "opportunity_cost",
    "social_proof",
    "specificity",
    "contrast",
    "authority",
    "reciprocity"
  ]),
  secondary: z.enum([
    "fomo",
    "loss_aversion",
    "opportunity_cost",
    "social_proof",
    "specificity",
    "contrast",
    "authority",
    "reciprocity"
  ]).nullable(),
  whyItFits: z.string().min(1),
  evidenceBasis: z.array(z.string().min(1)).min(1).max(6),
  applicationRule: z.string().min(1)
});

const OutreachPackage = z.object({
  industry: z.string().min(1),
  companyName: z.string().min(1),
  contactName: z.string().nullable(),
  contactTitle: z.string().nullable(),
  preferredChannel: z.enum([
    "email",
    "phone",
    "linkedin",
    "contact_form",
    "multi_channel"
  ]),
  personalizationSummary: z.string().min(1),
  persuasionFramework: PersuasionFramework,
  primaryEmail: EmailDraft,
  followUpEmail: EmailDraft,
  linkedinMessage: z.string().min(1).max(1800),
  callOpener: z.string().min(1).max(1800),
  contactFormMessage: z.string().min(1).max(2500),
  evidenceUsed: z.array(EvidenceUse).min(1).max(8),
  claimsToAvoid: z.array(z.string().min(1)).max(8),
  generationConfidence: z.number().int().min(0).max(100)
});

const model =
  process.env.OUTREACH_MODEL ||
  process.env.CONTACT_FORMAT_MODEL ||
  process.env.ENRICHMENT_FORMAT_MODEL ||
  process.env.DISCOVERY_FORMAT_MODEL ||
  process.env.DISCOVERY_MODEL ||
  "gpt-5.6-luna";

const outreachAgent = new Agent({
  name: "Personalized B2B Outreach Composer",
  model,
  instructions: [
    "Create concise, human-sounding B2B outreach drafts from verified prospect",
    "intelligence supplied by Agents 1-4.",
    "",
    "Do not perform new research. Do not invent facts, relationships, pain points,",
    "results, urgency, familiarity, or contact information.",
    "",
    "The goal is to start a useful business conversation, not pressure the prospect.",
    "Write like an experienced business-development professional who has done",
    "careful homework but does not want to sound invasive or over-researched.",
    "",
    "Use the resolved outreach angle and the strongest evidence-backed opportunity",
    "signals. Mention only facts that would feel natural for a prospect to hear.",
    "Avoid language that sounds like surveillance, such as describing detailed",
    "engagement tracking or saying that the prospect was 'researched.'",
    "",
    "Do not claim certainty about internal business problems. Phrase marketing",
    "observations as reasonable opportunities or questions when appropriate.",
    "",
    "Choose one primary persuasion framework that best fits the verified research.",
    "You may use one secondary framework only when it adds a distinct useful layer.",
    "Allowed frameworks:",
    "- fomo: emphasize a real, evidence-supported risk of missing a market, growth,",
    "  competitive, timing, or visibility opportunity. Never invent scarcity,",
    "  deadlines, competitor activity, or fake urgency.",
    "- loss_aversion: frame an evidence-supported cost of leaving an opportunity",
    "  unaddressed without exaggerating losses.",
    "- opportunity_cost: show what continued inaction may reasonably leave on the",
    "  table, based on the supplied opportunity signals.",
    "- social_proof: use only when the supplied context contains a legitimate",
    "  market, review, peer, or competitive signal. Never invent customer counts,",
    "  peer behavior, adoption rates, or testimonials.",
    "- specificity: lead with one concrete, verified observation rather than a",
    "  generic marketing claim.",
    "- contrast: compare the current public-facing experience with a clearly",
    "  supported better path, without claiming private performance.",
    "- authority: rely on demonstrated expertise, capability, or standards only",
    "  when supported by the supplied context.",
    "- reciprocity: lead by offering a useful observation, idea, or perspective",
    "  before asking for time.",
    "",
    "FOMO is not a default. Use it only when the research makes a genuine",
    "missed-opportunity or timing argument credible. In many B2B cases,",
    "specificity + opportunity cost will be more natural than overt urgency.",
    "",
    "Primary email:",
    "- short, personal, and conversational;",
    "- 70-170 words;",
    "- one clear reason for reaching out;",
    "- one low-friction CTA for a conversation;",
    "- no hype, fake urgency, or generic AI language.",
    "",
    "Follow-up email:",
    "- 45-100 words;",
    "- useful and respectful;",
    "- do not guilt the recipient for not replying.",
    "",
    "LinkedIn message:",
    "- brief and natural;",
    "- no long pitch.",
    "",
    "Call opener:",
    "- 20-45 seconds when spoken;",
    "- permission-based and conversational;",
    "- not a full sales script.",
    "",
    "Contact form message:",
    "- concise enough for ordinary website forms;",
    "- identify the business reason for contact clearly.",
    "",
    "Return JSON only, with no markdown fences or commentary."
  ].join("\n"),
  modelSettings: {
    reasoning: { effort: "low" },
    text: { verbosity: "low" }
  }
});

function parseJson(value) {
  if (typeof value !== "string") {
    throw new Error("Outreach composer did not return text.");
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
      throw new Error("Outreach composer returned invalid JSON.");
    }

    parsed = JSON.parse(unfenced.slice(firstBrace, lastBrace + 1));
  }

  const validated = OutreachPackage.safeParse(parsed);

  if (!validated.success) {
    const details = validated.error.issues
      .slice(0, 10)
      .map((issue) => (issue.path.join(".") || "root") + ": " + issue.message)
      .join("; ");

    throw new Error("Outreach JSON failed local validation: " + details);
  }

  return validated.data;
}

function compactContext({
  prospect,
  enrichment,
  scoring,
  contactResolution
}) {
  const primary = contactResolution.primaryDecisionMaker;

  return {
    prospect: {
      companyName: prospect.name,
      website: prospect.website,
      city: prospect.city || null,
      state: prospect.state || null,
      subindustry: prospect.subindustry || null,
      verifiedCapabilities:
        enrichment.verifiedCapabilities || prospect.capabilities || []
    },
    opportunity: {
      score: scoring.marketingOpportunityScore,
      tier: scoring.tier,
      summary: enrichment.opportunitySummary || "",
      growthSignals: (enrichment.growthSignals || []).slice(0, 6).map((item) => ({
        signal: item.signal,
        whyItMatters: item.whyItMatters
      })),
      marketingOpportunities: (enrichment.marketingSignals || [])
        .filter((item) => item.type === "opportunity")
        .slice(0, 8)
        .map((item) => ({
          area: item.area,
          finding: item.finding,
          whyItMatters: item.whyItMatters
        }))
    },
    contact: {
      primaryDecisionMaker: primary
        ? {
            name: primary.name,
            title: primary.title,
            roleCategory: primary.roleCategory,
            whyThisPerson: primary.whyThisPerson
          }
        : null,
      preferredChannel:
        contactResolution.outreachAngle?.recommendedChannel || "multi_channel",
      outreachAngle: contactResolution.outreachAngle?.angle || "",
      evidenceBasis:
        contactResolution.outreachAngle?.evidenceBasis || [],
      claimsToAvoid:
        contactResolution.outreachAngle?.avoidClaims || []
    }
  };
}

export async function composeOutreach({
  industry,
  prospect,
  enrichment,
  scoring,
  contactResolution
}) {
  const config = getIndustryConfig(industry);

  if (!config) {
    throw new Error("Unsupported industry: " + industry);
  }

  if (!prospect?.name || !prospect?.website) {
    throw new Error("Prospect name and website are required.");
  }

  if (!enrichment || !scoring || !contactResolution) {
    throw new Error(
      "Agent 2 enrichment, Agent 3 scoring, and Agent 4 contact resolution are required."
    );
  }

  const primary = contactResolution.primaryDecisionMaker || null;
  const context = compactContext({
    prospect,
    enrichment,
    scoring,
    contactResolution
  });

  const shape = {
    industry: config.id,
    companyName: prospect.name,
    contactName: primary?.name || null,
    contactTitle: primary?.title || null,
    preferredChannel:
      contactResolution.outreachAngle?.recommendedChannel || "multi_channel",
    personalizationSummary:
      "Why this outreach is relevant and what evidence it uses.",
    persuasionFramework: {
      primary: "specificity",
      secondary: "opportunity_cost",
      whyItFits:
        "Why these principles fit the verified business opportunity.",
      evidenceBasis: [
        "Specific verified research fact supporting this framework."
      ],
      applicationRule:
        "How the concept should shape the outreach without creating unsupported claims."
    },
    primaryEmail: {
      subject: "Short relevant subject line",
      body: "Concise personalized email body."
    },
    followUpEmail: {
      subject: "Short follow-up subject line",
      body: "Concise respectful follow-up."
    },
    linkedinMessage: "Short LinkedIn message.",
    callOpener: "Brief permission-based call opener.",
    contactFormMessage: "Short website contact-form message.",
    evidenceUsed: [
      {
        claim: "Fact or opportunity referenced in outreach.",
        sourceContext: "Which supplied evidence supports it."
      }
    ],
    claimsToAvoid:
      contactResolution.outreachAngle?.avoidClaims || [],
    generationConfidence: 90
  };

  const basePrompt = [
    "Industry: " + config.label,
    "Company: " + prospect.name,
    "Contact: " +
      (primary
        ? primary.name + ", " + primary.title
        : "No named primary contact verified"),
    "Marketing Opportunity Score: " + scoring.marketingOpportunityScore,
    "",
    "Create a personalized outreach draft package from this verified context:",
    JSON.stringify(context, null, 2),
    "",
    "Required JSON shape example:",
    JSON.stringify(shape, null, 2),
    "",
    "Important:",
    "- Do not introduce any fact not present in the supplied context.",
    "- Do not mention the numeric opportunity score to the prospect.",
    "- Do not say the prospect was scored, enriched, monitored, or researched.",
    "- Do not write as though we know private internal performance.",
    "- Select the persuasion framework from the allowed list based on the research.",
    "- Every persuasion-framework evidenceBasis item must come from the supplied context.",
    "- If using FOMO, loss aversion, social proof, authority, or contrast, the",
    "  factual basis must be explicitly present in the supplied context.",
    "- Use the persuasion principle to shape emphasis and framing, not to manufacture facts.",
    "- Keep the CTA conversational and low-friction.",
    "- Return JSON only."
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
      result = await run(outreachAgent, prompt);
    } catch (error) {
      error.agentStage = "outreach_generation";
      throw error;
    }

    if (!result.finalOutput) {
      const error = new Error("Outreach composer returned no output.");
      error.agentStage = "outreach_generation";
      throw error;
    }

    previousOutput = result.finalOutput;

    try {
      const parsed = parseJson(result.finalOutput);

      return {
        ...parsed,
        industry: config.id,
        companyName: prospect.name,
        contactName: primary?.name || parsed.contactName || null,
        contactTitle: primary?.title || parsed.contactTitle || null,
        preferredChannel:
          contactResolution.outreachAngle?.recommendedChannel ||
          parsed.preferredChannel
      };
    } catch (error) {
      previousError = error.message;

      if (attempt === 2) {
        error.agentStage = "outreach_json_validation";
        throw error;
      }
    }
  }

  throw new Error("Outreach composer failed unexpectedly.");
}

export { OutreachPackage };
