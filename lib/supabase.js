function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || null;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
  const key = secretKey || serviceRoleKey;

  let keyType = "missing";

  if (key) {
    if (key.startsWith("sb_secret_")) {
      keyType = "secret";
    } else if (key.startsWith("sb_publishable_")) {
      keyType = "publishable";
    } else {
      // Legacy anon/service_role keys are JWTs. Because this server only reads
      // secret/service-role env vars, a JWT here is treated as service_role.
      keyType = "service_role";
    }
  }

  return { url, key, keyType };
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

    const requiredColumns = [
      "id",
      "industry",
      "company_name",
      "website",
      "email",
      "subindustry",
      "company_type",
      "company_type_confidence",
      "capabilities",
      "discovery_confidence",
      "business_summary",
      "decision_makers",
      "contact_paths",
      "growth_signals",
      "marketing_signals",
      "enrichment_confidence",
      "marketing_opportunity_score",
      "score_tier",
      "score_breakdown",
      "score_version",
      "primary_decision_maker",
      "secondary_decision_makers",
      "resolved_contact_paths",
      "outreach_angle",
      "contact_resolution_summary",
      "contact_resolution_confidence",
      "contact_resolution_score",
      "contact_resolution_agent",
      "contact_resolved_at",
      "outreach_package",
      "outreach_preferred_channel",
      "outreach_generation_confidence",
      "outreach_agent",
      "outreach_generated_at"
    ];

    const tableResponse = await fetch(
      url.replace(/\/$/, "") +
        "/rest/v1/prospects?select=" +
        encodeURIComponent(requiredColumns.join(",")) +
        "&limit=0",
      {
        headers: supabaseHeaders(config, {
          Accept: "application/json"
        })
      }
    );

    const tableBody = await tableResponse.text();
    let tableDiagnostic = null;

    if (!tableResponse.ok) {
      try {
        const parsed = JSON.parse(tableBody);
        tableDiagnostic = {
          code: parsed.code || null,
          message: parsed.message || "Prospects table schema check failed."
        };
      } catch {
        tableDiagnostic = {
          code: null,
          message: "Prospects table schema check failed."
        };
      }
    }

    return {
      configured: true,
      connected: rootResponse.ok && tableResponse.ok,
      rootStatus: rootResponse.status,
      prospectsStatus: tableResponse.status,
      prospectsReadable: tableResponse.ok,
      prospectsSchemaReady: tableResponse.ok,
      keyType,
      diagnostic: tableDiagnostic
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


function firstVerifiedBusinessEmail(resolution) {
  const candidates = [
    resolution.primaryDecisionMaker?.publicBusinessEmail,
    ...(resolution.secondaryDecisionMakers || []).map(
      (person) => person.publicBusinessEmail
    ),
    ...(resolution.contactPaths || [])
      .filter((path) => path.type === "email")
      .map((path) => path.value)
  ];

  return candidates.find(
    (value) =>
      typeof value === "string" &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  ) || null;
}

export async function saveContactResolution(prospect, resolution) {
  const config = getSupabaseConfig();
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const now = new Date().toISOString();
  const website = resolution.website || prospect.website;
  const industry = resolution.industry;
  const resolvedEmail = firstVerifiedBusinessEmail(resolution);

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
      status: "CONTACT_RESOLVED",
      email: prospect.email || resolvedEmail || null,
      primary_decision_maker: resolution.primaryDecisionMaker,
      secondary_decision_makers: resolution.secondaryDecisionMakers,
      resolved_contact_paths: resolution.contactPaths,
      outreach_angle: resolution.outreachAngle,
      contact_resolution_summary: resolution.resolutionSummary,
      contact_resolution_confidence: resolution.resolutionConfidence,
      contact_resolution_score: resolution.marketingOpportunityScore,
      contact_resolution_agent: "deep-contact-resolution-v1",
      contact_resolved_at: now,
      updated_at: now
    })
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      "Supabase contact-resolution update failed (" +
        response.status +
        "): " +
        responseBody.slice(0, 500)
    );
  }

  const rows = responseBody ? JSON.parse(responseBody) : [];

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      "Supabase contact-resolution update did not match an existing prospect row."
    );
  }

  return rows;
}


export async function saveOutreachPackage(prospect, outreach) {
  const config = getSupabaseConfig();
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const now = new Date().toISOString();
  const website = prospect.website;
  const industry = outreach.industry;

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
      status: "OUTREACH_DRAFTED",
      outreach_package: outreach,
      outreach_preferred_channel: outreach.preferredChannel,
      outreach_generation_confidence: outreach.generationConfidence,
      outreach_agent: "personalized-outreach-composer-v1",
      outreach_generated_at: now,
      updated_at: now
    })
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      "Supabase outreach update failed (" +
        response.status +
        "): " +
        responseBody.slice(0, 500)
    );
  }

  const rows = responseBody ? JSON.parse(responseBody) : [];

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      "Supabase outreach update did not match an existing prospect row."
    );
  }

  return rows;
}


export async function createQualificationJob({
  industry,
  prospects,
  contactScoreThreshold,
  autoDraftPriority,
  draftScoreThreshold
}) {
  const config = getSupabaseConfig();
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const now = new Date().toISOString();
  const jobResponse = await fetch(
    url.replace(/\/$/, "") + "/rest/v1/qualification_jobs",
    {
      method: "POST",
      headers: supabaseHeaders(config, {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify([{
        status: "QUEUED",
        industry,
        requested_records: prospects.length,
        total_items: prospects.length,
        contact_score_threshold: contactScoreThreshold,
        auto_draft_priority: Boolean(autoDraftPriority),
        draft_score_threshold: draftScoreThreshold,
        counts: {
          queued: prospects.length,
          completed: 0,
          stopped: 0,
          failed: 0
        },
        created_at: now,
        updated_at: now
      }])
    }
  );

  const jobBody = await jobResponse.text();

  if (!jobResponse.ok) {
    throw new Error(
      "Supabase qualification job insert failed (" +
        jobResponse.status +
        "): " +
        jobBody.slice(0, 500)
    );
  }

  const jobs = jobBody ? JSON.parse(jobBody) : [];
  const job = jobs[0];

  if (!job?.id) {
    throw new Error("Qualification job insert returned no job id.");
  }

  const items = prospects.map((prospect) => ({
    job_id: job.id,
    industry,
    company_name: prospect.name,
    website: prospect.website,
    prospect_snapshot: prospect,
    status: "QUEUED",
    stage: "ENRICHMENT_QUEUED",
    attempts: 0,
    created_at: now,
    updated_at: now
  }));

  const itemResponse = await fetch(
    url.replace(/\/$/, "") + "/rest/v1/qualification_job_items",
    {
      method: "POST",
      headers: supabaseHeaders(config, {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(items)
    }
  );

  const itemBody = await itemResponse.text();

  if (!itemResponse.ok) {
    await updateQualificationJob(job.id, {
      status: "FAILED",
      last_error: "Could not create qualification job items.",
      updated_at: new Date().toISOString()
    }).catch(() => {});

    throw new Error(
      "Supabase qualification item insert failed (" +
        itemResponse.status +
        "): " +
        itemBody.slice(0, 500)
    );
  }

  return {
    ...job,
    items: itemBody ? JSON.parse(itemBody) : []
  };
}

export async function updateQualificationJob(jobId, patch) {
  const config = getSupabaseConfig();
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const response = await fetch(
    url.replace(/\/$/, "") +
      "/rest/v1/qualification_jobs?id=eq." +
      encodeURIComponent(jobId),
    {
      method: "PATCH",
      headers: supabaseHeaders(config, {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify({
        ...patch,
        updated_at: patch.updated_at || new Date().toISOString()
      })
    }
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      "Supabase qualification job update failed (" +
        response.status +
        "): " +
        body.slice(0, 500)
    );
  }

  const rows = body ? JSON.parse(body) : [];
  return rows[0] || null;
}

export async function updateQualificationJobItem(itemId, patch) {
  const config = getSupabaseConfig();
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const response = await fetch(
    url.replace(/\/$/, "") +
      "/rest/v1/qualification_job_items?id=eq." +
      encodeURIComponent(itemId),
    {
      method: "PATCH",
      headers: supabaseHeaders(config, {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify({
        ...patch,
        updated_at: patch.updated_at || new Date().toISOString()
      })
    }
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      "Supabase qualification item update failed (" +
        response.status +
        "): " +
        body.slice(0, 500)
    );
  }

  const rows = body ? JSON.parse(body) : [];
  return rows[0] || null;
}

export async function getQualificationJob(jobId) {
  const config = getSupabaseConfig();
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const base = url.replace(/\/$/, "");

  const [jobResponse, itemResponse] = await Promise.all([
    fetch(
      base +
        "/rest/v1/qualification_jobs?id=eq." +
        encodeURIComponent(jobId) +
        "&limit=1",
      { headers: supabaseHeaders(config, { Accept: "application/json" }) }
    ),
    fetch(
      base +
        "/rest/v1/qualification_job_items?job_id=eq." +
        encodeURIComponent(jobId) +
        "&order=created_at.asc",
      { headers: supabaseHeaders(config, { Accept: "application/json" }) }
    )
  ]);

  const jobBody = await jobResponse.text();
  const itemBody = await itemResponse.text();

  if (!jobResponse.ok || !itemResponse.ok) {
    throw new Error(
      "Supabase qualification job read failed (" +
        jobResponse.status +
        "/" +
        itemResponse.status +
        ")."
    );
  }

  const jobs = jobBody ? JSON.parse(jobBody) : [];
  const items = itemBody ? JSON.parse(itemBody) : [];

  return jobs[0] ? { ...jobs[0], items } : null;
}

export async function listResumableQualificationJobs(limit = 10) {
  const config = getSupabaseConfig();
  const { url, key } = config;

  if (!url || !key) return [];

  const response = await fetch(
    url.replace(/\/$/, "") +
      "/rest/v1/qualification_jobs?status=in.(QUEUED,RUNNING)&order=created_at.asc&limit=" +
      Math.max(1, Math.min(25, Number(limit) || 10)),
    {
      headers: supabaseHeaders(config, { Accept: "application/json" })
    }
  );

  if (!response.ok) return [];

  return response.json();
}
