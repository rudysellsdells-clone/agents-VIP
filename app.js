import http from "node:http";
import crypto from "node:crypto";
import { discoverDentalProspects } from "./agents/dental-discovery.js";
import {
  checkSupabaseConnection,
  upsertDiscoveredProspects
} from "./lib/supabase.js";

const port = process.env.PORT || 3000;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
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

async function handleDentalDiscovery(req, res) {
  const auth = isAuthorized(req);

  if (!auth.ok) {
    const statusCode = auth.reason.includes("not configured") ? 503 : 401;
    sendJson(res, statusCode, {
      status: "error",
      error: auth.reason
    });
    return;
  }

  let body;

  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { status: "error", error: error.message });
    return;
  }

  const market = typeof body.market === "string" ? body.market.trim() : "";
  const radiusMiles = Number(body.radiusMiles ?? 50);
  const maxResults = Number(body.maxResults ?? 15);

  if (!market) {
    sendJson(res, 400, {
      status: "error",
      error: "market is required, for example: Milwaukee, WI"
    });
    return;
  }

  if (
    !Number.isFinite(radiusMiles) ||
    radiusMiles < 1 ||
    radiusMiles > 250
  ) {
    sendJson(res, 400, {
      status: "error",
      error: "radiusMiles must be between 1 and 250."
    });
    return;
  }

  if (
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > 25
  ) {
    sendJson(res, 400, {
      status: "error",
      error: "maxResults must be an integer between 1 and 25."
    });
    return;
  }

  try {
    const discovery = await discoverDentalProspects({
      market,
      radiusMiles,
      maxResults
    });

    let persistence;

    try {
      const saved = await upsertDiscoveredProspects(discovery);
      persistence = {
        ok: true,
        saved: saved.length
      };
    } catch (error) {
      persistence = {
        ok: false,
        saved: 0,
        error: error.message
      };
    }

    sendJson(res, 200, {
      status: persistence.ok ? "ok" : "partial",
      agent: "dental-discovery-v1",
      model: process.env.DISCOVERY_MODEL || "gpt-5.4-mini",
      persistence,
      discovery
    });
  } catch (error) {
    console.error("Dental discovery failed:", error);

    sendJson(res, 500, {
      status: "error",
      agent: "dental-discovery-v1",
      error: error.message
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

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
        available: Boolean(process.env.AGENT_API_TOKEN),
        endpoint: "/api/agents/dental-discovery"
      }
    });
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/agents/dental-discovery"
  ) {
    await handleDentalDiscovery(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    sendJson(res, 200, {
      status: "ok",
      service: "VIP Prospecting Agents",
      version: "0.2.0",
      message: "Agent server is running.",
      health: "/health",
      agents: [
        {
          id: "dental-discovery-v1",
          method: "POST",
          endpoint: "/api/agents/dental-discovery",
          authentication: "Bearer token required"
        }
      ]
    });
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
