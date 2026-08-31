function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  return { url, key };
}

export async function checkSupabaseConnection() {
  const { url, key } = getSupabaseConfig();

  if (!url || !key) {
    return { configured: false, connected: false };
  }

  try {
    const response = await fetch(url.replace(/\/$/, "") + "/rest/v1/", {
      headers: {
        apikey: key
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

function capabilitiesObject(capabilities = []) {
  return Object.fromEntries(capabilities.map((item) => [item, true]));
}

export async function upsertDiscoveredProspects(discovery) {
  const { url, key } = getSupabaseConfig();

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
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
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
  const { url, key } = getSupabaseConfig();

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
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
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
