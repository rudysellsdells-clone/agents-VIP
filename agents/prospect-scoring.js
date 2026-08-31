import { getIndustryConfig } from "../config/industries.js";

const SCORE_VERSION = "marketing-opportunity-v1";

const MAX_POINTS = {
  icpFit: 20,
  marketingOpportunity: 20,
  highValueServices: 15,
  growthSignals: 15,
  competitiveOpportunity: 10,
  digitalWeakness: 10,
  decisionMakerAccess: 10
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function unique(values) {
  return [...new Set(values)];
}

function marketingOpportunities(enrichment) {
  return (enrichment.marketingSignals || []).filter(
    (signal) => signal.type === "opportunity"
  );
}

function scoreIcpFit(prospect) {
  const typePoints = {
    independent: 8,
    small_group: 8,
    regional: 6,
    unknown: 3
  };

  const typeScore = typePoints[prospect.companyType] ?? 3;
  const discoveryScore =
    clamp(Number(prospect.discoveryConfidence) || 0, 0, 100) * 0.06;
  const confidenceScore =
    clamp(Number(prospect.companyTypeConfidence) || 0, 0, 100) * 0.06;

  const score = round1(
    clamp(typeScore + discoveryScore + confidenceScore, 0, MAX_POINTS.icpFit)
  );

  return {
    score,
    max: MAX_POINTS.icpFit,
    reasons: [
      "Company type: " + (prospect.companyType || "unknown") + " = " + typeScore + " points.",
      "Discovery confidence contributes " + round1(discoveryScore) + " points.",
      "Company-type confidence contributes " + round1(confidenceScore) + " points."
    ]
  };
}

function scoreMarketingOpportunity(enrichment) {
  const opportunities = marketingOpportunities(enrichment);
  const uniqueAreas = unique(opportunities.map((signal) => signal.area));

  const signalPoints = Math.min(14, opportunities.length * 3.5);
  const breadthPoints = Math.min(6, uniqueAreas.length * 1.5);

  const score = round1(
    clamp(signalPoints + breadthPoints, 0, MAX_POINTS.marketingOpportunity)
  );

  return {
    score,
    max: MAX_POINTS.marketingOpportunity,
    reasons: [
      opportunities.length + " evidence-backed marketing opportunity signal(s).",
      uniqueAreas.length + " distinct marketing area(s) affected."
    ],
    signals: uniqueAreas
  };
}

function scoreHighValueServices(config, enrichment) {
  const verified = new Set(enrichment.verifiedCapabilities || []);
  const priorities = config.defaultPriorities || [];
  const matched = priorities.filter((id) => verified.has(id));

  const priorityRatio = priorities.length
    ? matched.length / priorities.length
    : 0;

  const priorityPoints = priorityRatio * 12;
  const breadthPoints = Math.min(
    3,
    Math.max(0, verified.size - matched.length) * 0.75
  );

  const score = round1(
    clamp(priorityPoints + breadthPoints, 0, MAX_POINTS.highValueServices)
  );

  return {
    score,
    max: MAX_POINTS.highValueServices,
    reasons: [
      matched.length + " of " + priorities.length + " priority capability/capabilities verified.",
      verified.size + " total verified capability/capabilities."
    ],
    signals: matched
  };
}

function scoreGrowthSignals(enrichment) {
  const count = (enrichment.growthSignals || []).length;
  let score = 0;

  if (count === 1) score = 6;
  else if (count === 2) score = 10;
  else if (count === 3) score = 13;
  else if (count >= 4) score = 15;

  return {
    score,
    max: MAX_POINTS.growthSignals,
    reasons: [
      count + " verified growth/investment signal(s)."
    ]
  };
}

function scoreCompetitiveOpportunity(enrichment) {
  const areas = new Set(
    marketingOpportunities(enrichment).map((signal) => signal.area)
  );

  const weights = {
    competitive: 5,
    positioning: 2,
    paid_visibility: 2,
    reviews_reputation: 1
  };

  const matched = Object.entries(weights)
    .filter(([area]) => areas.has(area));

  const score = round1(
    clamp(
      matched.reduce((total, [, points]) => total + points, 0),
      0,
      MAX_POINTS.competitiveOpportunity
    )
  );

  return {
    score,
    max: MAX_POINTS.competitiveOpportunity,
    reasons: matched.length
      ? matched.map(([area, points]) =>
          area.replaceAll("_", " ") + ": " + points + " points."
        )
      : ["No verified competitive-position opportunity signals."],
    signals: matched.map(([area]) => area)
  };
}

function scoreDigitalWeakness(enrichment) {
  const areas = new Set(
    marketingOpportunities(enrichment).map((signal) => signal.area)
  );

  const weights = {
    website_ux: 2,
    seo_content: 2,
    conversion: 2,
    ai_discovery: 2,
    social: 1,
    reviews_reputation: 1
  };

  const matched = Object.entries(weights)
    .filter(([area]) => areas.has(area));

  const score = round1(
    clamp(
      matched.reduce((total, [, points]) => total + points, 0),
      0,
      MAX_POINTS.digitalWeakness
    )
  );

  return {
    score,
    max: MAX_POINTS.digitalWeakness,
    reasons: matched.length
      ? matched.map(([area, points]) =>
          area.replaceAll("_", " ") + ": " + points + " points."
        )
      : ["No verified digital weakness signals."],
    signals: matched.map(([area]) => area)
  };
}

function scoreDecisionMakerAccess(enrichment) {
  const decisionMakers = enrichment.decisionMakers || [];
  const contactPaths = enrichment.contactPaths || [];

  const strongestDecisionMaker = decisionMakers.reduce(
    (best, person) => {
      const strategicRole = ["owner", "executive", "marketing", "operations", "business_development"]
        .includes(person.roleCategory);
      const confidence = strategicRole
        ? clamp(Number(person.confidence) || 0, 0, 100)
        : clamp(Number(person.confidence) || 0, 0, 100) * 0.6;

      return confidence > best ? confidence : best;
    },
    0
  );

  const decisionMakerPoints = strongestDecisionMaker * 0.05;

  const pathTypes = new Set(contactPaths.map((path) => path.type));
  let contactPoints = 0;

  if (pathTypes.has("email")) contactPoints += 3;
  if (pathTypes.has("phone") || pathTypes.has("contact_form")) contactPoints += 1;
  if (
    pathTypes.has("linkedin_professional") ||
    pathTypes.has("linkedin_company")
  ) {
    contactPoints += 1;
  }

  contactPoints = Math.min(5, contactPoints);

  const score = round1(
    clamp(
      decisionMakerPoints + contactPoints,
      0,
      MAX_POINTS.decisionMakerAccess
    )
  );

  return {
    score,
    max: MAX_POINTS.decisionMakerAccess,
    reasons: [
      decisionMakers.length + " verified decision-maker(s).",
      "Strongest decision-maker confidence contributes " +
        round1(decisionMakerPoints) +
        " points.",
      "Verified contact paths contribute " + contactPoints + " points."
    ],
    signals: [...pathTypes]
  };
}

function tierFor(score) {
  if (score >= 80) return "PRIORITY";
  if (score >= 65) return "STRONG";
  if (score >= 50) return "DEVELOP";
  return "LOW";
}

function actionFor(score) {
  if (score >= 80) {
    return "Advance to Agent 4 for deep contact resolution and outreach preparation.";
  }

  if (score >= 65) {
    return "Good candidate for Agent 4 after a brief human review of the evidence.";
  }

  if (score >= 50) {
    return "Keep in the pipeline, but review the weaker scoring categories before deeper contact work.";
  }

  return "Do not prioritize for deep contact work unless new evidence materially changes the score.";
}

export function scoreProspect({ industry, prospect, enrichment }) {
  const config = getIndustryConfig(industry);

  if (!config) {
    throw new Error("Unsupported industry: " + industry);
  }

  if (!prospect || !enrichment) {
    throw new Error("Prospect and enrichment are required for scoring.");
  }

  const breakdown = {
    icpFit: scoreIcpFit(prospect),
    marketingOpportunity: scoreMarketingOpportunity(enrichment),
    highValueServices: scoreHighValueServices(config, enrichment),
    growthSignals: scoreGrowthSignals(enrichment),
    competitiveOpportunity: scoreCompetitiveOpportunity(enrichment),
    digitalWeakness: scoreDigitalWeakness(enrichment),
    decisionMakerAccess: scoreDecisionMakerAccess(enrichment)
  };

  const total = round1(
    Object.values(breakdown).reduce(
      (sum, category) => sum + category.score,
      0
    )
  );

  const score = clamp(total, 0, 100);
  const tier = tierFor(score);

  return {
    scoreVersion: SCORE_VERSION,
    industry: config.id,
    companyName: prospect.name,
    website: prospect.website,
    marketingOpportunityScore: score,
    tier,
    nextAction: actionFor(score),
    breakdown,
    scoredAt: new Date().toISOString()
  };
}

export { SCORE_VERSION, MAX_POINTS };
