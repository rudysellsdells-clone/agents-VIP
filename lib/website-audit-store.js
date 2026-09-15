function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || null;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
  const key = secretKey || serviceRoleKey;

  let keyType = "missing";
  if (key) {
    if (key.startsWith("sb_secret_")) keyType = "secret";
    else if (key.startsWith("sb_publishable_")) keyType = "publishable";
    else keyType = "service_role";
  }

  return { url, key, keyType };
}

function supabaseHeaders({ key, keyType }, extra = {}) {
  if (!key) return { ...extra };
  const headers = { apikey: key, ...extra };
  if (keyType === "service_role") headers.Authorization = "Bearer " + key;
  return headers;
}

function normalizeWebsite(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value;
  }
}

function fromAuditRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    industry: row.industry,
    companyName: row.company_name,
    website: row.website,
    auditVersion: row.audit_version,
    auditDepth: row.audit_depth,
    pagesDiscovered: row.pages_discovered,
    pagesSampled: row.pages_sampled,
    robotsAccessible: row.robots_accessible,
    sitemapFound: row.sitemap_found,
    sitemapUrlsCount: row.sitemap_urls_count,
    websiteHealthScore: row.website_health_score,
    scores: row.scores || {},
    contentFreshness: row.content_freshness || {},
    structure: row.structure || {},
    conversion: row.conversion || {},
    technicalSeo: row.technical_seo || {},
    performance: row.performance || {},
    mobile: row.mobile || {},
    accessibility: row.accessibility || {},
    structuredData: row.structured_data || {},
    platform: row.platform || {},
    siteHygiene: row.site_hygiene || {},
    trust: row.trust || {},
    aiDiscoverability: row.ai_discoverability || {},
    findings: row.findings || [],
    evidence: row.evidence || [],
    auditConfidence: row.audit_confidence,
    pageSpeedAvailable: Boolean(row.pagespeed_available),
    pageSpeedError: row.pagespeed_error || null,
    auditedAt: row.audited_at,
    pages: []
  };
}

export async function checkWebsiteAuditSchema() {
  const config = getSupabaseConfig();
  const { url, key } = config;
  if (!url || !key) return { configured: false, ready: false };

  const base = url.replace(/\/$/, "");
  try {
    const [audits, pages, prospects] = await Promise.all([
      fetch(base + "/rest/v1/website_audits?select=id,website,audit_version&limit=0", {
        headers: supabaseHeaders(config, { Accept: "application/json" })
      }),
      fetch(base + "/rest/v1/website_audit_pages?select=id,audit_id,url&limit=0", {
        headers: supabaseHeaders(config, { Accept: "application/json" })
      }),
      fetch(
        base +
          "/rest/v1/prospects?select=" +
          encodeURIComponent([
            "id",
            "website_audit_id",
            "website_audit_version",
            "website_audited_at",
            "website_health_score",
            "content_freshness_score",
            "site_structure_score",
            "conversion_score",
            "technical_seo_score",
            "performance_score",
            "mobile_score",
            "accessibility_score",
            "structured_data_score",
            "platform_health_score",
            "trust_score",
            "ai_discoverability_score",
            "website_audit_summary"
          ].join(",")) +
          "&limit=0",
        {
          headers: supabaseHeaders(config, { Accept: "application/json" })
        }
      )
    ]);

    return {
      configured: true,
      ready: audits.ok && pages.ok && prospects.ok,
      auditsStatus: audits.status,
      pagesStatus: pages.status,
      prospectColumnsStatus: prospects.status
    };
  } catch (error) {
    return { configured: true, ready: false, error: error.message };
  }
}

export async function getRecentWebsiteAudit({
  industry,
  website,
  auditVersion,
  maxAgeDays = 30
}) {
  const config = getSupabaseConfig();
  const { url, key } = config;
  if (!url || !key) return null;

  const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  const normalized = normalizeWebsite(website);
  const endpoint =
    url.replace(/\/$/, "") +
    "/rest/v1/website_audits?industry=eq." + encodeURIComponent(industry) +
    "&website=eq." + encodeURIComponent(normalized) +
    "&audit_version=eq." + encodeURIComponent(auditVersion) +
    "&audited_at=gte." + encodeURIComponent(cutoff) +
    "&order=audited_at.desc&limit=1";

  const response = await fetch(endpoint, {
    headers: supabaseHeaders(config, { Accept: "application/json" })
  });

  if (!response.ok) {
    throw new Error("Website audit cache lookup failed (" + response.status + ").");
  }

  const rows = await response.json();
  return fromAuditRow(rows[0] || null);
}

export async function saveWebsiteAudit(prospect, audit) {
  const config = getSupabaseConfig();
  const { url, key } = config;
  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const base = url.replace(/\/$/, "");
  const normalizedProspectWebsite = normalizeWebsite(prospect.website);

  let prospectId = null;
  const prospectResponse = await fetch(
    base +
      "/rest/v1/prospects?industry=eq." + encodeURIComponent(audit.industry) +
      "&website=eq." + encodeURIComponent(normalizedProspectWebsite) +
      "&select=id&limit=1",
    { headers: supabaseHeaders(config, { Accept: "application/json" }) }
  );

  if (prospectResponse.ok) {
    const rows = await prospectResponse.json();
    prospectId = rows[0]?.id || null;
  }

  const row = {
    prospect_id: prospectId,
    industry: audit.industry,
    company_name: audit.companyName,
    website: normalizeWebsite(audit.website),
    audit_version: audit.auditVersion,
    audit_depth: audit.auditDepth,
    pages_discovered: audit.pagesDiscovered,
    pages_sampled: audit.pagesSampled,
    robots_accessible: audit.robotsAccessible,
    sitemap_found: audit.sitemapFound,
    sitemap_urls_count: audit.sitemapUrlsCount,
    website_health_score: audit.websiteHealthScore,
    scores: audit.scores,
    content_freshness: audit.contentFreshness,
    structure: audit.structure,
    conversion: audit.conversion,
    technical_seo: audit.technicalSeo,
    performance: audit.performance,
    mobile: audit.mobile,
    accessibility: audit.accessibility,
    structured_data: audit.structuredData,
    platform: audit.platform,
    site_hygiene: audit.siteHygiene,
    trust: audit.trust,
    ai_discoverability: audit.aiDiscoverability,
    findings: audit.findings,
    evidence: audit.evidence,
    audit_confidence: audit.auditConfidence,
    pagespeed_available: audit.pageSpeedAvailable,
    pagespeed_error: audit.pageSpeedError,
    audited_at: audit.auditedAt
  };

  const response = await fetch(base + "/rest/v1/website_audits", {
    method: "POST",
    headers: supabaseHeaders(config, {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify([row])
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      "Website audit insert failed (" + response.status + "): " + body.slice(0, 500)
    );
  }

  const saved = body ? JSON.parse(body)[0] : null;
  if (!saved?.id) throw new Error("Website audit insert returned no audit id.");

  if (Array.isArray(audit.pages) && audit.pages.length) {
    const pageRows = audit.pages.map((page) => ({
      audit_id: saved.id,
      url: page.url,
      page_type: page.pageType,
      http_status: page.httpStatus,
      title: page.title,
      title_length: page.titleLength,
      meta_description: page.metaDescription,
      canonical: page.canonical,
      h1: page.h1,
      h1_count: page.h1Count,
      heading_count: page.headingCount,
      heading_order_issues: page.headingOrderIssues,
      word_count: page.wordCount,
      published_date: page.publishedDate,
      modified_date: page.modifiedDate,
      estimated_content_age_days: page.estimatedContentAgeDays,
      content_stale: page.contentStale,
      internal_links: page.internalLinks,
      external_links: page.externalLinks,
      images: page.images,
      missing_alt_images: page.missingAltImages,
      forms: page.forms,
      primary_cta: page.primaryCta,
      has_viewport: page.hasViewport,
      schema_types: page.schemaTypes,
      cms_signals: page.cmsSignals,
      content_quality_score: page.contentQualityScore,
      conversion_score: page.conversionScore,
      technical_seo_score: page.technicalSeoScore,
      findings: page.findings,
      evidence: page.evidence
    }));

    const pageResponse = await fetch(base + "/rest/v1/website_audit_pages", {
      method: "POST",
      headers: supabaseHeaders(config, {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify(pageRows)
    });

    if (!pageResponse.ok) {
      const pageBody = await pageResponse.text();
      throw new Error(
        "Website audit page insert failed (" + pageResponse.status + "): " + pageBody.slice(0, 500)
      );
    }
  }

  const summary = {
    auditId: saved.id,
    auditVersion: audit.auditVersion,
    auditedAt: audit.auditedAt,
    pagesSampled: audit.pagesSampled,
    auditConfidence: audit.auditConfidence,
    scores: audit.scores,
    platform: audit.platform,
    findings: audit.findings.slice(0, 8)
  };

  const patchResponse = await fetch(
    base +
      "/rest/v1/prospects?industry=eq." + encodeURIComponent(audit.industry) +
      "&website=eq." + encodeURIComponent(normalizedProspectWebsite),
    {
      method: "PATCH",
      headers: supabaseHeaders(config, {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify({
        website_audit_id: saved.id,
        website_audit_version: audit.auditVersion,
        website_audited_at: audit.auditedAt,
        website_health_score: audit.websiteHealthScore,
        content_freshness_score: audit.scores.contentFreshness,
        site_structure_score: audit.scores.siteStructure,
        conversion_score: audit.scores.conversion,
        technical_seo_score: audit.scores.technicalSeo,
        performance_score: audit.scores.performance,
        mobile_score: audit.scores.mobile,
        accessibility_score: audit.scores.accessibility,
        structured_data_score: audit.scores.structuredData,
        platform_health_score: audit.scores.platformHealth,
        trust_score: audit.scores.trust,
        ai_discoverability_score: audit.scores.aiDiscoverability,
        website_audit_summary: summary,
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!patchResponse.ok) {
    const patchBody = await patchResponse.text();
    throw new Error(
      "Prospect website-audit summary update failed (" + patchResponse.status + "): " + patchBody.slice(0, 500)
    );
  }

  return { ...audit, id: saved.id };
}
