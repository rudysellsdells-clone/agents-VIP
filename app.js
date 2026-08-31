import http from "node:http";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { discoverProspects } from "./agents/prospect-discovery.js";
import { enrichProspect } from "./agents/prospect-enrichment.js";
import { scoreProspect } from "./agents/prospect-scoring.js";
import {
  COMPANY_TYPE_IDS,
  getIndustryConfig,
  getPublicIndustryConfigs
} from "./config/industries.js";
import {
  checkSupabaseConnection,
  upsertDiscoveredProspects,
  upsertProspectEnrichment,
  saveProspectScore
} from "./lib/supabase.js";

const port = process.env.PORT || 3000;
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const publicRateLimits = new Map();

const PUBLIC_WINDOW_MS = 60 * 60 * 1000;
const PUBLIC_MAX_SEARCHES = Math.max(
  1,
  Number(process.env.PUBLIC_SEARCHES_PER_HOUR || 20)
);

const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/ui.js", { file: "ui.js", type: "text/javascript; charset=utf-8" }]
]);

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function sendStatic(res, pathname) {
  const asset = STATIC_FILES.get(pathname);
  if (!asset) return false;

  try {
    const content = await readFile(path.join(publicDir, asset.file));
    res.writeHead(200, {
      "Content-Type": asset.type,
      "Cache-Control":
        asset.file === "index.html" ? "no-cache" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(content);
  } catch (error) {
    console.error("Static asset error:", error);
    sendJson(res, 500, {
      status: "error",
      error: "Unable to load application."
    });
  }

  return true;
}

async function readJsonBody(req, maxBytes = 32768) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;

    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error("Request body is too large.");
      error.validation = true;
      throw error;
    }
  }

  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.validation = true;
    throw error;
  }
}

function isAuthorized(req) {
  const expected = process.env.AGENT_API_TOKEN;

  if (!expected) {
    return { ok: false, reason: "AGENT_API_TOKEN is not configured." };
  }

  const authorization = req.headers.authorization || "";
  const prefix = "Bearer ";

  if (!authorization.startsWith(prefix)) {
    return { ok: false, reason: "Missing bearer token." };
  }

  const supplied = authorization.slice(prefix.length);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  if (expectedBuffer.length !== suppliedBuffer.length) {
    return { ok: false, reason: "Invalid bearer token." };
  }

  const matches = crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
  return { ok: matches, reason: matches ? null : "Invalid bearer token." };
}

function getClientIp(req) {
  const cloudflare = req.headers["cf-connecting-ip"];
  if (typeof cloudflare === "string" && cloudflare.trim()) {
    return cloudflare.trim();
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function consumePublicRateLimit(req) {
  const now = Date.now();
  const ip = getClientIp(req);
  const current = publicRateLimits.get(ip);

  if (!current || now >= current.resetAt) {
    const next = {
      count: 1,
      resetAt: now + PUBLIC_WINDOW_MS
    };
    publicRateLimits.set(ip, next);

    return {
      allowed: true,
      remaining: PUBLIC_MAX_SEARCHES - 1,
      resetAt: next.resetAt
    };
  }

  if (current.count >= PUBLIC_MAX_SEARCHES) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt
    };
  }

  current.count += 1;
  publicRateLimits.set(ip, current);

  return {
    allowed: true,
    remaining: Math.max(0, PUBLIC_MAX_SEARCHES - current.count),
    resetAt: current.resetAt
  };
}

function validationError(message) {
  const error = new Error(message);
  error.validation = true;
  return error;
}

function normalizeStringArray(value, allowed) {
  if (!Array.isArray(value)) return [];

  const allowedSet = new Set(allowed);

  return [...new Set(
    value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => allowedSet.has(item))
  )];
}

function validateDiscoveryRequest(
  body,
  { publicRequest = false, forcedIndustry = null } = {}
) {
  const industry =
    forcedIndustry ||
    (typeof body.industry === "string" ? body.industry.trim() : "dental");
  const config = getIndustryConfig(industry);

  if (!config) {
    throw validationError("Choose a supported industry.");
  }

  const market = typeof body.market === "string" ? body.market.trim() : "";
  const radiusMiles = Number(body.radiusMiles ?? 25);
  const maxResults = Number(body.maxResults ?? (publicRequest ? 5 : 15));

  const maxRadius = publicRequest ? 100 : 250;
  const maxCount = publicRequest ? 10 : 25;

  if (market.length < 2 || market.length > 120) {
    throw validationError("Enter a valid city, state, or market.");
  }

  if (
    !Number.isFinite(radiusMiles) ||
    radiusMiles < 1 ||
    radiusMiles > maxRadius
  ) {
    throw validationError(
      "Radius must be between 1 and " + maxRadius + " miles."
    );
  }

  if (
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > maxCount
  ) {
    throw validationError(
      "Number of prospects must be between 1 and " + maxCount + "."
    );
  }

  const priorities = normalizeStringArray(
    body.priorities,
    config.capabilities.map((item) => item.id)
  );

  const companyTypes = normalizeStringArray(
    body.companyTypes || body.practiceTypes,
    COMPANY_TYPE_IDS
  );

  return {
    industry,
    market,
    radiusMiles,
    maxResults,
    priorities,
    companyTypes: companyTypes.length
      ? companyTypes
      : ["independent", "small_group"]
  };
}

function classifyAgentError(error) {
  const status = Number(error?.status || error?.statusCode || 0) || null;
  const code = String(error?.code || error?.error?.code || "").toLowerCase();
  const type = String(error?.type || error?.error?.type || "").toLowerCase();
  const message = String(error?.message || error?.error?.message || "");
  const haystack = (code + " " + type + " " + message).toLowerCase();
  const stage = error?.agentStage || null;

  if (
    haystack.includes("insufficient_quota") ||
    haystack.includes("billing") ||
    haystack.includes("credit balance")
  ) {
    return {
      statusCode: 503,
      publicMessage:
        "OpenAI API billing or quota is not available for this project.",
      diagnostic: { provider: "openai", category: "quota", stage, status, code: code || null }
    };
  }

  if (status === 429 || haystack.includes("rate limit")) {
    return {
      statusCode: 503,
      publicMessage:
        "The OpenAI API is currently rate-limiting this search. Please retry shortly.",
      diagnostic: { provider: "openai", category: "rate_limit", stage, status, code: code || null }
    };
  }

  if (
    status === 401 ||
    haystack.includes("invalid api key") ||
    haystack.includes("incorrect api key")
  ) {
    return {
      statusCode: 503,
      publicMessage:
        "The OpenAI API key configured on the server was rejected.",
      diagnostic: { provider: "openai", category: "authentication", stage, status, code: code || null }
    };
  }

  if (status === 403 || haystack.includes("permission")) {
    return {
      statusCode: 503,
      publicMessage:
        "The OpenAI project does not currently have permission to run this search.",
      diagnostic: { provider: "openai", category: "permission", stage, status, code: code || null }
    };
  }

  if (
    haystack.includes("timeout") ||
    haystack.includes("timed out") ||
    haystack.includes("etimedout") ||
    haystack.includes("econnreset")
  ) {
    return {
      statusCode: 504,
      publicMessage:
        "The research request took too long to finish. Please try a smaller search.",
      diagnostic: { provider: "runtime", category: "timeout", stage, status, code: code || null }
    };
  }

  if (
    stage === "local_json_validation" ||
    stage === "enrichment_json_validation"
  ) {
    return {
      statusCode: 500,
      publicMessage:
        "Research completed, but the formatter could not normalize the results. Please retry the research.",
      diagnostic: { provider: "runtime", category: "format_validation", stage, status, code: code || null }
    };
  }

  if (status === 400 || haystack.includes("schema")) {
    return {
      statusCode: 500,
      publicMessage:
        "The agent request reached OpenAI but its request configuration was rejected.",
      diagnostic: { provider: "openai", category: "request_configuration", stage, status, code: code || null }
    };
  }

  return {
    statusCode: 500,
    publicMessage:
      "The prospecting agent could not complete this search. Check the cPanel App Logs for the server-side error.",
    diagnostic: {
      provider: status ? "openai" : "runtime",
      category: "unknown",
      stage,
      status,
      code: code || null
    }
  };
}


function validateEnrichmentRequest(body) {
  const industry =
    typeof body.industry === "string" ? body.industry.trim() : "";
  const config = getIndustryConfig(industry);

  if (!config) {
    throw validationError("Choose a supported industry.");
  }

  const prospect = body.prospect && typeof body.prospect === "object"
    ? body.prospect
    : null;

  if (!prospect) {
    throw validationError("A prospect is required for enrichment.");
  }

  const name =
    typeof prospect.name === "string" ? prospect.name.trim() : "";
  const website =
    typeof prospect.website === "string" ? prospect.website.trim() : "";

  if (!name || name.length > 180) {
    throw validationError("A valid prospect name is required.");
  }

  let parsedWebsite;

  try {
    parsedWebsite = new URL(website);
  } catch {
    throw validationError("A valid prospect website is required.");
  }

  if (!["http:", "https:"].includes(parsedWebsite.protocol)) {
    throw validationError("Prospect website must use HTTP or HTTPS.");
  }

  const cleanArray = (value, maxItems, maxLength) =>
    Array.isArray(value)
      ? value
          .filter((item) => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, maxItems)
          .map((item) => item.slice(0, maxLength))
      : [];

  return {
    industry,
    prospect: {
      name,
      website: parsedWebsite.toString(),
      city:
        typeof prospect.city === "string"
          ? prospect.city.trim().slice(0, 120)
          : "",
      state:
        typeof prospect.state === "string"
          ? prospect.state.trim().slice(0, 80)
          : "",
      phone:
        typeof prospect.phone === "string"
          ? prospect.phone.trim().slice(0, 80)
          : null,
      email:
        typeof prospect.email === "string"
          ? prospect.email.trim().slice(0, 254)
          : null,
      subindustry:
        typeof prospect.subindustry === "string"
          ? prospect.subindustry.trim().slice(0, 160)
          : null,
      companyType:
        COMPANY_TYPE_IDS.includes(prospect.companyType)
          ? prospect.companyType
          : "unknown",
      companyTypeConfidence: Number.isFinite(
        Number(prospect.companyTypeConfidence)
      )
        ? Math.max(
            0,
            Math.min(100, Math.round(Number(prospect.companyTypeConfidence)))
          )
        : null,
      capabilities: normalizeStringArray(
        prospect.capabilities,
        config.capabilities.map((item) => item.id)
      ),
      discoveryConfidence: Number.isFinite(
        Number(prospect.discoveryConfidence)
      )
        ? Math.max(
            0,
            Math.min(100, Math.round(Number(prospect.discoveryConfidence)))
          )
        : null,
      fitReasons: cleanArray(prospect.fitReasons, 6, 500),
      evidence: Array.isArray(prospect.evidence)
        ? prospect.evidence.slice(0, 8).map((item) => ({
            url:
              item && typeof item.url === "string"
                ? item.url.slice(0, 1000)
                : "",
            fact:
              item && typeof item.fact === "string"
                ? item.fact.slice(0, 1000)
                : ""
          }))
        : [],
      market:
        typeof prospect.market === "string"
          ? prospect.market.trim().slice(0, 120)
          : null,
      radiusMiles: Number.isFinite(Number(prospect.radiusMiles))
        ? Number(prospect.radiusMiles)
        : null
    }
  };
}

async function runEnrichment(payload) {
  const enrichment = await enrichProspect(payload);

  let persistence;

  try {
    const saved = await upsertProspectEnrichment(
      payload.prospect,
      enrichment
    );

    persistence = {
      ok: true,
      saved: saved.length
    };
  } catch (error) {
    console.error("Prospect enrichment persistence failed:", error);
    persistence = {
      ok: false,
      saved: 0,
      error:
        "Enrichment completed but could not be saved to the prospect database.",
      diagnostic: classifyPersistenceError(error)
    };
  }

  return { enrichment, persistence };
}

async function handlePrivateEnrichment(req, res) {
  const auth = isAuthorized(req);

  if (!auth.ok) {
    const statusCode = auth.reason.includes("not configured") ? 503 : 401;
    sendJson(res, statusCode, {
      status: "error",
      error: auth.reason
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const payload = validateEnrichmentRequest(body);
    const { enrichment, persistence } = await runEnrichment(payload);

    sendJson(res, 200, {
      status: persistence.ok ? "ok" : "partial",
      agent: "prospect-enrichment-v1",
      persistence,
      enrichment
    });
  } catch (error) {
    console.error("Private enrichment failed:", error);

    if (error.validation) {
      sendJson(res, 400, {
        status: "error",
        agent: "prospect-enrichment-v1",
        error: error.message
      });
      return;
    }

    const classified = classifyAgentError(error);

    sendJson(res, classified.statusCode, {
      status: "error",
      agent: "prospect-enrichment-v1",
      error: classified.publicMessage,
      diagnostic: classified.diagnostic,
      requestId: error?.request_id || error?.requestId || null
    });
  }
}

async function handlePublicEnrichment(req, res) {
  try {
    const body = await readJsonBody(req);
    const payload = validateEnrichmentRequest(body);
    const limit = consumePublicRateLimit(req);

    if (!limit.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((limit.resetAt - Date.now()) / 1000)
      );

      sendJson(
        res,
        429,
        {
          status: "error",
          error: "Public research limit reached. Please try again later."
        },
        { "Retry-After": String(retryAfter) }
      );
      return;
    }

    const { enrichment, persistence } = await runEnrichment(payload);

    sendJson(
      res,
      200,
      {
        status: persistence.ok ? "ok" : "partial",
        agent: "prospect-enrichment-v1",
        persistence,
        limits: {
          remainingThisHour: limit.remaining,
          resetsAt: new Date(limit.resetAt).toISOString()
        },
        enrichment
      },
      {
        "X-RateLimit-Limit": String(PUBLIC_MAX_SEARCHES),
        "X-RateLimit-Remaining": String(limit.remaining)
      }
    );
  } catch (error) {
    console.error("Public enrichment failed:", error);

    if (error.validation) {
      sendJson(res, 400, {
        status: "error",
        agent: "prospect-enrichment-v1",
        error: error.message
      });
      return;
    }

    const classified = classifyAgentError(error);

    sendJson(res, classified.statusCode, {
      status: "error",
      agent: "prospect-enrichment-v1",
      error: classified.publicMessage,
      diagnostic: classified.diagnostic,
      requestId: error?.request_id || error?.requestId || null
    });
  }
}


function validateScoringRequest(body) {
  const industry =
    typeof body.industry === "string" ? body.industry.trim() : "";
  const config = getIndustryConfig(industry);

  if (!config) {
    throw validationError("Choose a supported industry.");
  }

  if (!body.prospect || typeof body.prospect !== "object") {
    throw validationError("A prospect is required for scoring.");
  }

  if (!body.enrichment || typeof body.enrichment !== "object") {
    throw validationError("Agent 2 enrichment is required before scoring.");
  }

  const prospectPayload = validateEnrichmentRequest({
    industry,
    prospect: body.prospect
  });

  const enrichment = body.enrichment;

  const cleanStringArray = (value, maxItems, maxLength) =>
    Array.isArray(value)
      ? value
          .filter((item) => typeof item === "string")
          .map((item) => item.trim().slice(0, maxLength))
          .filter(Boolean)
          .slice(0, maxItems)
      : [];

  const cleanEvidence = (value, maxItems = 4) =>
    Array.isArray(value)
      ? value
          .slice(0, maxItems)
          .map((item) => ({
            url:
              item && typeof item.url === "string"
                ? item.url.slice(0, 1000)
                : "",
            fact:
              item && typeof item.fact === "string"
                ? item.fact.slice(0, 1000)
                : ""
          }))
          .filter((item) => item.url && item.fact)
      : [];

  const allowedMarketingAreas = [
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
  ];

  const allowedMarketingTypes = ["strength", "opportunity", "unknown"];
  const allowedRoleCategories = [
    "owner",
    "executive",
    "marketing",
    "operations",
    "business_development",
    "other"
  ];

  const normalizedEnrichment = {
    businessSummary:
      typeof enrichment.businessSummary === "string"
        ? enrichment.businessSummary.slice(0, 5000)
        : "",
    subindustry:
      typeof enrichment.subindustry === "string"
        ? enrichment.subindustry.slice(0, 200)
        : null,
    serviceArea:
      typeof enrichment.serviceArea === "string"
        ? enrichment.serviceArea.slice(0, 1000)
        : null,
    companySizeSignals: cleanStringArray(
      enrichment.companySizeSignals,
      8,
      500
    ),
    verifiedCapabilities: normalizeStringArray(
      enrichment.verifiedCapabilities,
      config.capabilities.map((item) => item.id)
    ),
    decisionMakers: Array.isArray(enrichment.decisionMakers)
      ? enrichment.decisionMakers.slice(0, 8).map((person) => ({
          name:
            person && typeof person.name === "string"
              ? person.name.slice(0, 200)
              : "",
          title:
            person && typeof person.title === "string"
              ? person.title.slice(0, 200)
              : "",
          roleCategory: allowedRoleCategories.includes(person?.roleCategory)
            ? person.roleCategory
            : "other",
          professionalUrl:
            person && typeof person.professionalUrl === "string"
              ? person.professionalUrl.slice(0, 1000)
              : null,
          publicBusinessEmail:
            person && typeof person.publicBusinessEmail === "string"
              ? person.publicBusinessEmail.slice(0, 254)
              : null,
          confidence: Number.isFinite(Number(person?.confidence))
            ? Math.max(0, Math.min(100, Math.round(Number(person.confidence))))
            : 0,
          evidence: cleanEvidence(person?.evidence, 5)
        }))
      : [],
    contactPaths: Array.isArray(enrichment.contactPaths)
      ? enrichment.contactPaths.slice(0, 10).map((path) => ({
          type:
            typeof path?.type === "string" ? path.type.slice(0, 80) : "other",
          label:
            typeof path?.label === "string" ? path.label.slice(0, 200) : "",
          value:
            typeof path?.value === "string" ? path.value.slice(0, 1000) : null,
          url:
            typeof path?.url === "string" ? path.url.slice(0, 1000) : null,
          evidence: cleanEvidence(path?.evidence, 3)
        }))
      : [],
    growthSignals: Array.isArray(enrichment.growthSignals)
      ? enrichment.growthSignals.slice(0, 10).map((signal) => ({
          signal:
            typeof signal?.signal === "string"
              ? signal.signal.slice(0, 500)
              : "",
          whyItMatters:
            typeof signal?.whyItMatters === "string"
              ? signal.whyItMatters.slice(0, 1000)
              : "",
          evidence: cleanEvidence(signal?.evidence, 4)
        }))
      : [],
    marketingSignals: Array.isArray(enrichment.marketingSignals)
      ? enrichment.marketingSignals.slice(0, 14).map((signal) => ({
          area: allowedMarketingAreas.includes(signal?.area)
            ? signal.area
            : "other",
          type: allowedMarketingTypes.includes(signal?.type)
            ? signal.type
            : "unknown",
          finding:
            typeof signal?.finding === "string"
              ? signal.finding.slice(0, 1000)
              : "",
          whyItMatters:
            typeof signal?.whyItMatters === "string"
              ? signal.whyItMatters.slice(0, 1000)
              : "",
          evidence: cleanEvidence(signal?.evidence, 4)
        }))
      : [],
    opportunitySummary:
      typeof enrichment.opportunitySummary === "string"
        ? enrichment.opportunitySummary.slice(0, 5000)
        : "",
    enrichmentConfidence: Number.isFinite(
      Number(enrichment.enrichmentConfidence)
    )
      ? Math.max(
          0,
          Math.min(100, Math.round(Number(enrichment.enrichmentConfidence)))
        )
      : 0
  };

  return {
    industry,
    prospect: prospectPayload.prospect,
    enrichment: normalizedEnrichment
  };
}

async function runScoring(payload) {
  const scoring = scoreProspect(payload);

  let persistence;

  try {
    const saved = await saveProspectScore(payload.prospect, scoring);
    persistence = {
      ok: true,
      saved: saved.length
    };
  } catch (error) {
    console.error("Prospect scoring persistence failed:", error);
    persistence = {
      ok: false,
      saved: 0,
      error:
        "Scoring completed but could not be saved to the prospect database.",
      diagnostic: classifyPersistenceError(error)
    };
  }

  return { scoring, persistence };
}

async function handleScoring(req, res, requireAuth) {
  if (requireAuth) {
    const auth = isAuthorized(req);

    if (!auth.ok) {
      const statusCode = auth.reason.includes("not configured") ? 503 : 401;
      sendJson(res, statusCode, {
        status: "error",
        error: auth.reason
      });
      return;
    }
  }

  try {
    const body = await readJsonBody(req, 131072);
    const payload = validateScoringRequest(body);
    const { scoring, persistence } = await runScoring(payload);

    sendJson(res, 200, {
      status: persistence.ok ? "ok" : "partial",
      agent: "marketing-opportunity-scoring-v1",
      deterministic: true,
      persistence,
      scoring
    });
  } catch (error) {
    console.error("Prospect scoring failed:", error);

    if (error.validation) {
      sendJson(res, 400, {
        status: "error",
        agent: "marketing-opportunity-scoring-v1",
        error: error.message
      });
      return;
    }

    sendJson(res, 500, {
      status: "error",
      agent: "marketing-opportunity-scoring-v1",
      error: "The deterministic scoring engine could not complete this score."
    });
  }
}

async function checkOpenAI() {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    return { configured: false, connected: false };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: "Bearer " + key
      }
    });

    return {
      configured: true,
      connected: response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error: error.message
    };
  }
}


function classifyPersistenceError(error) {
  const message = String(error?.message || "");
  const lower = message.toLowerCase();

  let category = "unknown";

  if (
    lower.includes("(401)") ||
    lower.includes("invalid jwt") ||
    lower.includes("unauthorized")
  ) {
    category = "authentication";
  } else if (
    lower.includes("(403)") ||
    lower.includes("permission denied") ||
    lower.includes("row-level security") ||
    lower.includes("rls")
  ) {
    category = "permission";
  } else if (
    lower.includes("could not find the") ||
    lower.includes("column") ||
    lower.includes("schema cache") ||
    lower.includes("pgrst204") ||
    lower.includes("pgrst205")
  ) {
    category = "schema";
  } else if (
    lower.includes("did not match an existing prospect row")
  ) {
    category = "row_match";
  }

  const statusMatch = message.match(/\((\d{3})\)/);

  return {
    category,
    status: statusMatch ? Number(statusMatch[1]) : null
  };
}

async function runDiscovery(payload) {
  const discovery = await discoverProspects(payload);

  let persistence;

  try {
    const saved = await upsertDiscoveredProspects(discovery);
    persistence = {
      ok: true,
      saved: saved.length
    };
  } catch (error) {
    console.error("Prospect persistence failed:", error);
    persistence = {
      ok: false,
      saved: 0,
      error:
        "Results were found but could not be saved to the prospect database.",
      diagnostic: classifyPersistenceError(error)
    };
  }

  return { discovery, persistence };
}

async function handlePrivateDiscovery(req, res, forcedIndustry = null) {
  const auth = isAuthorized(req);

  if (!auth.ok) {
    const statusCode = auth.reason.includes("not configured") ? 503 : 401;
    sendJson(res, statusCode, {
      status: "error",
      error: auth.reason
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const payload = validateDiscoveryRequest(body, { forcedIndustry });
    const { discovery, persistence } = await runDiscovery(payload);

    sendJson(res, 200, {
      status: persistence.ok ? "ok" : "partial",
      agent: "universal-prospect-discovery-v1",
      models: {
        research:
          process.env.DISCOVERY_RESEARCH_MODEL ||
          process.env.DISCOVERY_MODEL ||
          "gpt-5.6-luna",
        formatter:
          process.env.DISCOVERY_FORMAT_MODEL ||
          process.env.DISCOVERY_MODEL ||
          "gpt-5.6-luna"
      },
      persistence,
      discovery
    });
  } catch (error) {
    console.error("Private discovery failed:", error);

    if (error.validation) {
      sendJson(res, 400, {
        status: "error",
        agent: "universal-prospect-discovery-v1",
        error: error.message
      });
      return;
    }

    const classified = classifyAgentError(error);
    sendJson(res, classified.statusCode, {
      status: "error",
      agent: "universal-prospect-discovery-v1",
      error: classified.publicMessage,
      diagnostic: classified.diagnostic,
      requestId: error?.request_id || error?.requestId || null
    });
  }
}

async function handlePublicDiscovery(req, res, forcedIndustry = null) {
  try {
    const body = await readJsonBody(req);
    const payload = validateDiscoveryRequest(body, {
      publicRequest: true,
      forcedIndustry
    });

    const limit = consumePublicRateLimit(req);

    if (!limit.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((limit.resetAt - Date.now()) / 1000)
      );

      sendJson(
        res,
        429,
        {
          status: "error",
          error: "Public search limit reached. Please try again later."
        },
        { "Retry-After": String(retryAfter) }
      );
      return;
    }

    const { discovery, persistence } = await runDiscovery(payload);

    sendJson(
      res,
      200,
      {
        status: persistence.ok ? "ok" : "partial",
        agent: "universal-prospect-discovery-v1",
        persistence,
        limits: {
          remainingThisHour: limit.remaining,
          resetsAt: new Date(limit.resetAt).toISOString()
        },
        discovery
      },
      {
        "X-RateLimit-Limit": String(PUBLIC_MAX_SEARCHES),
        "X-RateLimit-Remaining": String(limit.remaining)
      }
    );
  } catch (error) {
    console.error("Public discovery failed:", error);

    if (error.validation) {
      sendJson(res, 400, {
        status: "error",
        agent: "universal-prospect-discovery-v1",
        error: error.message
      });
      return;
    }

    const classified = classifyAgentError(error);

    sendJson(res, classified.statusCode, {
      status: "error",
      agent: "universal-prospect-discovery-v1",
      error: classified.publicMessage,
      diagnostic: classified.diagnostic,
      requestId: error?.request_id || error?.requestId || null
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

  if (req.method === "GET" && STATIC_FILES.has(url.pathname)) {
    await sendStatic(res, url.pathname);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/industries") {
    sendJson(res, 200, {
      industries: getPublicIndustryConfigs()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    const [supabase, openai] = await Promise.all([
      checkSupabaseConnection(),
      checkOpenAI()
    ]);

    const healthy = supabase.connected && openai.connected;

    sendJson(res, healthy ? 200 : 503, {
      status: healthy ? "ok" : "degraded",
      service: "VIP Prospect Intelligence",
      node: {
        connected: true,
        version: process.version,
        environment: process.env.NODE_ENV || "unknown"
      },
      supabase,
      openai,
      discovery: {
        industries: getPublicIndustryConfigs().map((item) => item.id),
        privateEndpoint: {
          available: Boolean(process.env.AGENT_API_TOKEN),
          endpoint: "/api/agents/discovery"
        },
        publicEndpoint: {
          available: true,
          endpoint: "/api/public/discovery",
          maxResults: 10,
          searchesPerHour: PUBLIC_MAX_SEARCHES
        }
      },
      enrichment: {
        privateEndpoint: {
          available: Boolean(process.env.AGENT_API_TOKEN),
          endpoint: "/api/agents/enrichment"
        },
        publicEndpoint: {
          available: true,
          endpoint: "/api/public/enrichment"
        }
      },
      scoring: {
        deterministic: true,
        privateEndpoint: {
          available: Boolean(process.env.AGENT_API_TOKEN),
          endpoint: "/api/agents/scoring"
        },
        publicEndpoint: {
          available: true,
          endpoint: "/api/public/scoring"
        }
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agents/scoring") {
    await handleScoring(req, res, true);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/public/scoring") {
    await handleScoring(req, res, false);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agents/enrichment") {
    await handlePrivateEnrichment(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/public/enrichment") {
    await handlePublicEnrichment(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agents/discovery") {
    await handlePrivateDiscovery(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/public/discovery") {
    await handlePublicDiscovery(req, res);
    return;
  }

  // Backward-compatible dental aliases.
  if (
    req.method === "POST" &&
    url.pathname === "/api/agents/dental-discovery"
  ) {
    await handlePrivateDiscovery(req, res, "dental");
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/public/dental-discovery"
  ) {
    await handlePublicDiscovery(req, res, "dental");
    return;
  }

  sendJson(res, 404, {
    status: "error",
    error: "Not found"
  });
});

server.listen(port, () => {
  console.log("VIP Prospect Intelligence running on port " + port);
});
