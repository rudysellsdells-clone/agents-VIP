import http from "node:http";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { discoverDentalProspects } from "./agents/dental-discovery.js";
import {
  checkSupabaseConnection,
  upsertDiscoveredProspects
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
      "Cache-Control": asset.file === "index.html" ? "no-cache" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(content);
  } catch (error) {
    console.error("Static asset error:", error);
    sendJson(res, 500, { status: "error", error: "Unable to load application." });
  }

  return true;
}

async function readJsonBody(req, maxBytes = 32768) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;

    if (Buffer.byteLength(body) > maxBytes) {
      throw new Error("Request body is too large.");
    }
  }

  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON.");
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

function normalizeStringArray(value, allowed) {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => allowed.includes(item))
  )];
}

function validateDiscoveryRequest(body, { publicRequest = false } = {}) {
  const market = typeof body.market === "string" ? body.market.trim() : "";
  const radiusMiles = Number(body.radiusMiles ?? 25);
  const maxResults = Number(body.maxResults ?? (publicRequest ? 5 : 15));

  const maxRadius = publicRequest ? 100 : 250;
  const maxCount = publicRequest ? 10 : 25;

  if (market.length < 2 || market.length > 120) {
    throw new Error("Enter a valid city, state, or market.");
  }

  if (
    !Number.isFinite(radiusMiles) ||
    radiusMiles < 1 ||
    radiusMiles > maxRadius
  ) {
    throw new Error(`Radius must be between 1 and ${maxRadius} miles.`);
  }

  if (
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > maxCount
  ) {
    throw new Error(`Number of prospects must be between 1 and ${maxCount}.`);
  }

  const priorities = normalizeStringArray(body.priorities, [
    "implants",
    "fullMouth",
    "cosmetic",
    "clearAligners",
    "sedation"
  ]);

  const practiceTypes = normalizeStringArray(body.practiceTypes, [
    "independent",
    "small_group",
    "unknown"
  ]);

  return {
    market,
    radiusMiles,
    maxResults,
    priorities,
    practiceTypes: practiceTypes.length
      ? practiceTypes
      : ["independent", "small_group"]
  };
}


function classifyAgentError(error) {
  const status = Number(error?.status || error?.statusCode || 0) || null;
  const code = String(error?.code || error?.error?.code || "").toLowerCase();
  const type = String(error?.type || error?.error?.type || "").toLowerCase();
  const message = String(error?.message || error?.error?.message || "");
  const haystack = `${code} ${type} ${message}`.toLowerCase();

  if (
    haystack.includes("insufficient_quota") ||
    haystack.includes("billing") ||
    haystack.includes("credit balance")
  ) {
    return {
      statusCode: 503,
      publicMessage:
        "OpenAI API billing or quota is not available for this project. Check the API Platform billing/usage settings for the key used by this app.",
      diagnostic: { provider: "openai", category: "quota", stage: error?.agentStage || null, status, code: code || null }
    };
  }

  if (status === 429 || haystack.includes("rate limit")) {
    return {
      statusCode: 503,
      publicMessage:
        "The OpenAI API is currently rate-limiting this agent. Please retry shortly.",
      diagnostic: { provider: "openai", category: "rate_limit", stage: error?.agentStage || null, status, code: code || null }
    };
  }

  if (status === 401 || haystack.includes("invalid api key") || haystack.includes("incorrect api key")) {
    return {
      statusCode: 503,
      publicMessage:
        "The OpenAI API key configured on the server was rejected. Check OPENAI_API_KEY in the cPanel app environment.",
      diagnostic: { provider: "openai", category: "authentication", stage: error?.agentStage || null, status, code: code || null }
    };
  }

  if (status === 403 || haystack.includes("permission")) {
    return {
      statusCode: 503,
      publicMessage:
        "The OpenAI project does not currently have permission to run this agent or one of its tools.",
      diagnostic: { provider: "openai", category: "permission", stage: error?.agentStage || null, status, code: code || null }
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
        "The research request took too long to finish. This may be a server or proxy timeout rather than a search-quality problem.",
      diagnostic: { provider: "runtime", category: "timeout", stage: error?.agentStage || null, status, code: code || null }
    };
  }

  if (status === 400 || haystack.includes("schema") || haystack.includes("structured output")) {
    return {
      statusCode: 500,
      publicMessage:
        "The agent request reached OpenAI but its tool or structured-output configuration was rejected.",
      diagnostic: { provider: "openai", category: "request_configuration", stage: error?.agentStage || null, status, code: code || null }
    };
  }

  return {
    statusCode: 500,
    publicMessage:
      "The prospecting agent could not complete this search. Check the cPanel App Logs for the server-side error.",
    diagnostic: {
      provider: status ? "openai" : "runtime",
      category: "unknown",
      stage: error?.agentStage || null,
      status,
      code: code || null
    }
  };
}

async function checkOpenAI() {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    return { configured: false, connected: false };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${key}`
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

async function runDiscovery(payload) {
  const discovery = await discoverDentalProspects(payload);

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
      error: "Results were found but could not be saved to the prospect database."
    };
  }

  return { discovery, persistence };
}

async function handlePrivateDentalDiscovery(req, res) {
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
    const payload = validateDiscoveryRequest(body);
    const { discovery, persistence } = await runDiscovery(payload);

    sendJson(res, 200, {
      status: persistence.ok ? "ok" : "partial",
      agent: "dental-discovery-v1",
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
    console.error("Private dental discovery failed:", error);
    const validationError =
      error.message.startsWith("Enter ") ||
      error.message.startsWith("Radius ") ||
      error.message.startsWith("Number ");

    sendJson(res, validationError ? 400 : 500, {
      status: "error",
      agent: "dental-discovery-v1",
      error: error.message
    });
  }
}

async function handlePublicDentalDiscovery(req, res) {
  try {
    const body = await readJsonBody(req);
    const payload = validateDiscoveryRequest(body, { publicRequest: true });
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
        agent: "dental-discovery-v1",
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
    console.error("Public dental discovery failed:", error);
    const validationError =
      error.message.startsWith("Enter ") ||
      error.message.startsWith("Radius ") ||
      error.message.startsWith("Number ");

    if (validationError) {
      sendJson(res, 400, {
        status: "error",
        agent: "dental-discovery-v1",
        error: error.message
      });
      return;
    }

    const classified = classifyAgentError(error);

    sendJson(res, classified.statusCode, {
      status: "error",
      agent: "dental-discovery-v1",
      error: classified.publicMessage,
      diagnostic: classified.diagnostic,
      requestId: error?.request_id || error?.requestId || null
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && STATIC_FILES.has(url.pathname)) {
    await sendStatic(res, url.pathname);
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
      service: "VIP Prospecting Agents",
      node: {
        connected: true,
        version: process.version,
        environment: process.env.NODE_ENV || "unknown"
      },
      supabase,
      openai,
      dentalDiscovery: {
        privateEndpoint: {
          available: Boolean(process.env.AGENT_API_TOKEN),
          endpoint: "/api/agents/dental-discovery"
        },
        publicEndpoint: {
          available: true,
          endpoint: "/api/public/dental-discovery",
          maxResults: 10,
          searchesPerHour: PUBLIC_MAX_SEARCHES
        }
      }
    });
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/agents/dental-discovery"
  ) {
    await handlePrivateDentalDiscovery(req, res);
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/public/dental-discovery"
  ) {
    await handlePublicDentalDiscovery(req, res);
    return;
  }

  sendJson(res, 404, {
    status: "error",
    error: "Not found"
  });
});

server.listen(port, () => {
  console.log(`VIP Prospecting Agents running on port ${port}`);
});
