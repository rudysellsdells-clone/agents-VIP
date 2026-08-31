function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || null;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
  const key = secretKey || serviceRoleKey;

  return {
    url,
    key,
    keyType: secretKey
      ? "secret"
      : serviceRoleKey
        ? "service_role"
        : "missing"
  };
}

function supabaseHeaders({ key, keyType }, extra = {}) {
  if (!key) return { ...extra };

  const headers = {
    apikey: key,
    ...extra
  };

  // New sb_secret_* keys must be sent on apikey only.
  // Legacy service_role JWT keys need Authorization to reliably bypass RLS.
  if (keyType === "service_role") {
    headers.Authorization = "Bearer " + key;
  }

  return headers;
}

export async function checkSupabaseConnection() {
  const config = getSupabaseConfig();
  const { url, key, keyType } = config;

  if (!url || !key) {
    return { configured: false, connected: false, keyType };
  }

  try {
    const rootResponse = await fetch(url.replace(/\/$/, "") + "/rest/v1/", {
      headers: supabaseHeaders(config)
    });

    const tableResponse = await fetch(
      url.replace(/\/$/, "") +
        "/rest/v1/prospects?select=id&limit=1",
      {
        headers: supabaseHeaders(config, {
          Accept: "application/json"
        })
      }
    );

    const tableBody = await tableResponse.text();

    return {
      configured: true,
      connected: rootResponse.ok && tableResponse.ok,
      rootStatus: rootResponse.status,
      prospectsStatus: tableResponse.status,
      prospectsReadable: tableResponse.ok,
      keyType,
      diagnostic: tableResponse.ok
        ? null
        : tableBody.slice(0, 300)
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      keyType,
      error: error.message
    };
  }
}

function capabilitiesObject(capabilities = []) {
  return Object.fromEntries(capabilities.map((item) => [item, true]));
}

export async function upsertDiscoveredProspects(discovery) {
  const config = getSupabaseConfig();
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const now = new Date().toISOString();

  const rows = discovery.prospects.map((prospect) => ({
    industry: discovery.industry,
    subindustry: prospect.subindustry,
    company_name: prospect.name,
    website: prospect.website,
    phone: prospect.phone,
    email: prospect.email,
    city: prospect.city,
    state: prospect.state,
    status: "DISCOVERED",
    market: discovery.market,
    radius_miles: discovery.radiusMiles,
    company_type: prospect.companyType,
    company_type_confidence: prospect.companyTypeConfidence,
    capabilities: prospect.capabilities,
    discovery_confidence: prospect.discoveryConfidence,
    fit_reasons: prospect.fitReasons,
    evidence: prospect.evidence,
    discovery_agent: "universal-prospect-discovery-v1",
    last_discovered_at: now,
    updated_at: now,

    // Legacy dental-era fields retained for backward compatibility.
    practice_type: prospect.companyType,
    independence_confidence: prospect.companyTypeConfidence,
    services: capabilitiesObject(prospect.capabilities)
  }));

  if (rows.length === 0) return [];

  const endpoint =
    url.replace(/\/$/, "") +
    "/rest/v1/prospects?on_conflict=industry,website";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(config, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify(rows)
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      "Supabase upsert failed (" +
        response.status +
        "): " +
        responseBody.slice(0, 500)
    );
  }

  return responseBody ? JSON.parse(responseBody) : [];
}


function findPublicBusinessEmail(enrichment) {
  for (const path of enrichment.contactPaths || []) {
    if (path.type !== "email" || !path.value) continue;

    const value = String(path.value).trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return value;
    }
  }

  return null;
}

export async function upsertProspectEnrichment(prospect, enrichment) {
  const config = getSupabaseConfig();
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const now = new Date().toISOString();
  const discoveredEmail = findPublicBusinessEmail(enrichment);

  const row = {
    industry: enrichment.industry,
    subindustry: enrichment.subindustry || prospect.subindustry || null,
    company_name: enrichment.companyName || prospect.name,
    website: enrichment.website || prospect.website,
    phone: prospect.phone || null,
    email: prospect.email || discoveredEmail || null,
    city: prospect.city || null,
    state: prospect.state || null,
    status: "ENRICHED",
    market: prospect.market || null,
    radius_miles: prospect.radiusMiles || null,
    company_type: prospect.companyType || null,
    company_type_confidence: prospect.companyTypeConfidence || null,
    capabilities: enrichment.verifiedCapabilities || prospect.capabilities || [],
    discovery_confidence: prospect.discoveryConfidence || null,
    fit_reasons: prospect.fitReasons || [],
    evidence: prospect.evidence || [],
    discovery_agent: "universal-prospect-discovery-v1",
    last_discovered_at: prospect.lastDiscoveredAt || null,

    business_summary: enrichment.businessSummary,
    service_area: enrichment.serviceArea,
    company_size_signals: enrichment.companySizeSignals,
    decision_makers: enrichment.decisionMakers,
    contact_paths: enrichment.contactPaths,
    growth_signals: enrichment.growthSignals,
    marketing_signals: enrichment.marketingSignals,
    opportunity_summary: enrichment.opportunitySummary,
    enrichment_confidence: enrichment.enrichmentConfidence,
    enrichment_agent: "prospect-enrichment-v1",
    enriched_at: now,
    updated_at: now,

    // Legacy dental-era fields retained for compatibility.
    practice_type: prospect.companyType || null,
    independence_confidence: prospect.companyTypeConfidence || null,
    services: capabilitiesObject(
      enrichment.verifiedCapabilities || prospect.capabilities || []
    )
  };

  const endpoint =
    url.replace(/\/$/, "") +
    "/rest/v1/prospects?on_conflict=industry,website";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(config, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify([row])
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      "Supabase enrichment upsert failed (" +
        response.status +
        "): " +
        responseBody.slice(0, 500)
    );
  }

  return responseBody ? JSON.parse(responseBody) : [];
}


export async function saveProspectScore(prospect, scoring) {
  const config = getSupabaseConfig();
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const now = new Date().toISOString();
  const website = scoring.website || prospect.website;
  const industry = scoring.industry;

  const endpoint =
    url.replace(/\/$/, "") +
    "/rest/v1/prospects?industry=eq." +
    encodeURIComponent(industry) +
    "&website=eq." +
    encodeURIComponent(website);

  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(config, {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify({
      status: "SCORED",
      marketing_opportunity_score: scoring.marketingOpportunityScore,
      score_tier: scoring.tier,
      score_breakdown: scoring.breakdown,
      score_version: scoring.scoreVersion,
      score_next_action: scoring.nextAction,
      scored_at: scoring.scoredAt || now,
      updated_at: now
    })
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      "Supabase score update failed (" +
        response.status +
        "): " +
        responseBody.slice(0, 500)
    );
  }

  const rows = responseBody ? JSON.parse(responseBody) : [];

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      "Supabase score update did not match an existing prospect row."
    );
  }

  return rows;
}
