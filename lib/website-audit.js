import dns from "node:dns/promises";
import net from "node:net";
import {
  getRecentWebsiteAudit,
  saveWebsiteAudit
} from "./supabase.js";

export const WEBSITE_AUDIT_VERSION = "website-intelligence-v1";

const MAX_PAGES = Math.max(
  3,
  Math.min(20, Number(process.env.WEBSITE_AUDIT_MAX_PAGES || 15))
);
const CACHE_DAYS = Math.max(
  1,
  Math.min(180, Number(process.env.WEBSITE_AUDIT_CACHE_DAYS || 30))
);
const FETCH_TIMEOUT_MS = Math.max(
  3000,
  Math.min(20000, Number(process.env.WEBSITE_AUDIT_FETCH_TIMEOUT_MS || 8000))
);
const HTML_LIMIT_BYTES = 2 * 1024 * 1024;
const AUX_LIMIT_BYTES = 1024 * 1024;

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function normalizeHostname(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item))) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateAddress(address) {
  const type = net.isIP(address);
  if (type === 4) return isPrivateIpv4(address);
  if (type !== 6) return true;

  const value = address.toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;

  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  return false;
}

async function assertPublicUrl(value) {
  const url = new URL(value);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Website audit supports HTTP and HTTPS only.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Website audit refused a non-public hostname.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Website audit refused a private network address.");
    }
    return url;
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("Website audit refused a non-public network target.");
  }

  return url;
}

async function readLimitedBody(response, maxBytes) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Website response exceeded the audit size limit.");
    }

    output += decoder.decode(value, { stream: true });
  }

  output += decoder.decode();
  return output;
}

async function safeFetchText(value, { maxBytes = HTML_LIMIT_BYTES } = {}) {
  let current = await assertPublicUrl(value);

  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "VIPWebsiteIntelligence/1.0 (+website marketing audit)",
          Accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.5"
        }
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect response did not include a location.");
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }

    const text = await readLimitedBody(response, maxBytes);
    return {
      url: current.toString(),
      status: response.status,
      headers: response.headers,
      text
    };
  }

  throw new Error("Website audit exceeded the redirect limit.");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(html, regex) {
  const match = regex.exec(html);
  return match ? stripTags(match[1]) : null;
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i")
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return stripTags(match[1]);
  }

  return null;
}

function linkHrefByRel(html, rel) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i);
    if (!relMatch || !relMatch[1].toLowerCase().split(/\s+/).includes(rel)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i);
    if (href) return href[1];
  }
  return null;
}

function extractDateCandidates(html) {
  const values = [
    metaContent(html, "article:published_time"),
    metaContent(html, "article:modified_time"),
    metaContent(html, "date"),
    metaContent(html, "datePublished"),
    metaContent(html, "dateModified")
  ].filter(Boolean);

  const times = html.match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/gi) || [];
  for (const tag of times.slice(0, 5)) {
    const match = tag.match(/datetime=["']([^"']+)["']/i);
    if (match) values.push(match[1]);
  }

  const jsonDateRegex = /"(?:datePublished|dateModified)"\s*:\s*"([^"]+)"/gi;
  let match;
  while ((match = jsonDateRegex.exec(html)) && values.length < 12) {
    values.push(match[1]);
  }

  return values
    .map((value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    })
    .filter(Boolean)
    .filter((date) => date.getFullYear() >= 1990 && date <= new Date());
}

function extractSchemaTypes(html) {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const types = new Set();

  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value["@type"]) {
      const entries = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
      entries.forEach((item) => types.add(String(item)));
    }
    Object.values(value).forEach(visit);
  }

  for (const script of scripts.slice(0, 20)) {
    const body = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      visit(JSON.parse(body));
    } catch {
      // Invalid JSON-LD is still handled as a finding elsewhere.
    }
  }

  return [...types].slice(0, 40);
}

function detectTechnology(html) {
  const lower = html.toLowerCase();
  const generator = metaContent(html, "generator");
  const signals = [];
  let cms = null;
  let cmsVersion = null;
  let confidence = 0;

  const setCms = (name, score, signal) => {
    if (score > confidence) {
      cms = name;
      confidence = score;
    }
    signals.push(signal);
  };

  if (lower.includes("/wp-content/") || lower.includes("/wp-includes/")) {
    setCms("WordPress", 98, "WordPress asset paths detected");
  }
  if (lower.includes("wixstatic.com") || lower.includes("wix.com/website-template")) {
    setCms("Wix", 96, "Wix asset signatures detected");
  }
  if (lower.includes("static1.squarespace.com") || lower.includes("squarespace-cdn.com")) {
    setCms("Squarespace", 96, "Squarespace asset signatures detected");
  }
  if (lower.includes("cdn.shopify.com") || lower.includes("shopify.theme")) {
    setCms("Shopify", 96, "Shopify asset signatures detected");
  }
  if (lower.includes("webflow.io") || lower.includes("data-wf-page")) {
    setCms("Webflow", 95, "Webflow signatures detected");
  }
  if (lower.includes("/sites/default/files/") && lower.includes("drupal")) {
    setCms("Drupal", 92, "Drupal signatures detected");
  }
  if (lower.includes("hs-scripts.com") || lower.includes("hubspotusercontent")) {
    setCms("HubSpot CMS", 92, "HubSpot CMS asset signatures detected");
  }

  if (generator) {
    signals.push("Generator: " + generator);
    const wp = generator.match(/wordpress\s*([0-9.]+)?/i);
    if (wp) {
      setCms("WordPress", 100, "WordPress generator metadata detected");
      cmsVersion = wp[1] || null;
    }
    const drupal = generator.match(/drupal\s*([0-9.]+)?/i);
    if (drupal) {
      setCms("Drupal", 100, "Drupal generator metadata detected");
      cmsVersion = drupal[1] || null;
    }
    const joomla = generator.match(/joomla!?\s*([0-9.]+)?/i);
    if (joomla) {
      setCms("Joomla", 100, "Joomla generator metadata detected");
      cmsVersion = joomla[1] || null;
    }
  }

  const libraries = [];
  const jquery = html.match(/jquery(?:\.min)?[-.]([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
  if (jquery) libraries.push({ name: "jQuery", version: jquery[1] });
  if (lower.includes("__next_data__") || lower.includes("/_next/")) {
    libraries.push({ name: "Next.js", version: null });
  }
  if (lower.includes("__nuxt__") || lower.includes("/_nuxt/")) {
    libraries.push({ name: "Nuxt", version: null });
  }

  return {
    cmsDetected: cms,
    cmsConfidence: confidence || null,
    cmsVersionDetected: cmsVersion,
    generator: generator || null,
    libraries,
    signals: [...new Set(signals)].slice(0, 12)
  };
}

function pageType(url) {
  const path = new URL(url).pathname.toLowerCase();
  if (path === "/" || path === "") return "homepage";
  if (/\b(contact|book|appointment|schedule)\b/.test(path)) return "contact";
  if (/\b(about|team|staff|doctor|attorney|leadership|people)\b/.test(path)) return "about_team";
  if (/\b(blog|news|article|insights|resources)\b/.test(path)) return "article";
  if (/\b(location|locations|office|offices|areas-we-serve)\b/.test(path)) return "location";
  if (/\b(service|services|implant|cosmetic|roof|hvac|plumb|law|machin|fabricat|remodel|injury|estate)\b/.test(path)) return "service";
  return "other";
}

function pagePriority(url) {
  const type = pageType(url);
  const weights = {
    homepage: 100,
    service: 90,
    contact: 85,
    about_team: 80,
    location: 75,
    article: 65,
    other: 40
  };
  return weights[type] || 40;
}

function extractLinks(html, baseUrl, rootHostname) {
  const tags = html.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/gi) || [];
  const links = [];

  for (const tag of tags.slice(0, 1000)) {
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;

    try {
      const url = new URL(href, baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const host = normalizeHostname(url.hostname);
      if (host !== rootHostname) continue;
      links.push(normalizeUrl(url.toString()));
    } catch {
      // Ignore malformed links.
    }
  }

  return [...new Set(links)];
}

function extractPage(html, responseUrl, status, headers, rootHostname) {
  const title = firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = metaContent(html, "description");
  const canonicalRaw = linkHrefByRel(html, "canonical");
  let canonical = null;
  try {
    canonical = canonicalRaw ? new URL(canonicalRaw, responseUrl).toString() : null;
  } catch {
    canonical = null;
  }

  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => ({ level: Number(match[1]), text: stripTags(match[2]) }));
  const h1s = headings.filter((item) => item.level === 1);
  let headingOrderIssues = 0;
  for (let i = 1; i < headings.length; i += 1) {
    if (headings[i].level - headings[i - 1].level > 1) headingOrderIssues += 1;
  }

  const cleanText = stripTags(html);
  const wordCount = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;
  const links = extractLinks(html, responseUrl, rootHostname);
  const allAnchorTags = html.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/gi) || [];
  const externalLinks = allAnchorTags.filter((tag) => {
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) return false;
    try {
      return normalizeHostname(new URL(href, responseUrl).hostname) !== rootHostname;
    } catch {
      return false;
    }
  }).length;

  const images = html.match(/<img\b[^>]*>/gi) || [];
  const missingAltImages = images.filter((tag) => {
    const alt = tag.match(/\balt=["']([^"']*)["']/i);
    return !alt || !alt[1].trim();
  }).length;

  const forms = (html.match(/<form\b/gi) || []).length;
  const hasViewport = Boolean(metaContent(html, "viewport"));
  const ctaMatch = [...html.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)]
    .map((match) => stripTags(match[1]))
    .find((text) => /\b(book|schedule|appointment|consult|contact|get (?:a )?quote|request|call|estimate|demo|start)\b/i.test(text));

  const dates = extractDateCandidates(html);
  const publishedDate = dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
  const modifiedDate = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
  const referenceDate = modifiedDate || publishedDate;
  const ageDays = referenceDate
    ? Math.max(0, Math.round((Date.now() - referenceDate.getTime()) / 86400000))
    : null;

  const schemaTypes = extractSchemaTypes(html);
  const technology = detectTechnology(html);
  const pageKind = pageType(responseUrl);
  const isStale = ageDays !== null && (
    (pageKind === "article" && ageDays > 730) ||
    (pageKind !== "article" && ageDays > 1460)
  );

  let seoScore = 100;
  if (!title) seoScore -= 20;
  if (!metaDescription) seoScore -= 12;
  if (h1s.length !== 1) seoScore -= 15;
  if (!canonical) seoScore -= 10;
  if (status >= 400) seoScore -= 30;
  if (images.length && missingAltImages / images.length > 0.25) seoScore -= 8;
  if (headingOrderIssues > 1) seoScore -= 5;

  let conversionScore = 45;
  if (ctaMatch) conversionScore += 25;
  if (forms > 0) conversionScore += 12;
  if (/href=["']tel:/i.test(html)) conversionScore += 8;
  if (/\b(financ|payment|insurance|estimate|quote)\b/i.test(cleanText)) conversionScore += 5;
  if (/\b(testimonial|review|case stud|before.{0,5}after|award)\b/i.test(cleanText)) conversionScore += 5;

  let contentQualityScore = 45;
  if (wordCount >= (pageKind === "article" ? 700 : 350)) contentQualityScore += 20;
  if (headings.length >= 3) contentQualityScore += 10;
  if (title && h1s.length === 1) contentQualityScore += 10;
  if (schemaTypes.length) contentQualityScore += 5;
  if (ctaMatch) contentQualityScore += 5;

  return {
    url: responseUrl,
    pageType: pageKind,
    httpStatus: status,
    title,
    titleLength: title?.length || 0,
    metaDescription,
    canonical,
    h1: h1s[0]?.text || null,
    h1Count: h1s.length,
    headingCount: headings.length,
    headingOrderIssues,
    wordCount,
    publishedDate: publishedDate?.toISOString() || null,
    modifiedDate: modifiedDate?.toISOString() || null,
    estimatedContentAgeDays: ageDays,
    contentStale: isStale,
    internalLinks: links.length,
    externalLinks,
    images: images.length,
    missingAltImages,
    forms,
    primaryCta: ctaMatch || null,
    hasViewport,
    schemaTypes,
    cmsSignals: technology.signals,
    contentQualityScore: clamp(contentQualityScore),
    conversionScore: clamp(conversionScore),
    technicalSeoScore: clamp(seoScore),
    links,
    technology,
    responseHeaders: {
      strictTransportSecurity: headers.get("strict-transport-security"),
      contentSecurityPolicy: headers.get("content-security-policy"),
      xContentTypeOptions: headers.get("x-content-type-options"),
      referrerPolicy: headers.get("referrer-policy")
    },
    textSignals: {
      hasTestimonials: /\b(testimonial|what (?:our )?(?:clients|patients|customers) say|reviews?)\b/i.test(cleanText),
      hasAwards: /\b(award|winner|recognized|accredit)\b/i.test(cleanText),
      hasTeamLanguage: /\b(our team|meet the team|our doctors|our attorneys|leadership)\b/i.test(cleanText),
      hasLocationLanguage: /\b(serving|located in|locations?|service area)\b/i.test(cleanText),
      hasServiceLanguage: /\b(services?|treatments?|solutions?|capabilities|practice areas?)\b/i.test(cleanText)
    }
  };
}

async function fetchRobotsAndSitemap(rootUrl) {
  const origin = new URL(rootUrl).origin;
  let robotsAccessible = null;
  let sitemapFound = false;
  const sitemapUrls = new Set();
  const candidateSitemaps = new Set([new URL("/sitemap.xml", origin).toString()]);

  try {
    const robots = await safeFetchText(new URL("/robots.txt", origin).toString(), {
      maxBytes: AUX_LIMIT_BYTES
    });
    robotsAccessible = robots.status < 400;
    for (const match of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      candidateSitemaps.add(match[1]);
    }
  } catch {
    robotsAccessible = false;
  }

  for (const sitemapUrl of [...candidateSitemaps].slice(0, 4)) {
    try {
      const result = await safeFetchText(sitemapUrl, { maxBytes: AUX_LIMIT_BYTES });
      if (result.status >= 400 || !/<(?:urlset|sitemapindex)\b/i.test(result.text)) continue;
      sitemapFound = true;
      const locs = [...result.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
        .map((match) => match[1].trim())
        .slice(0, 500);

      for (const loc of locs) {
        if (/\.xml(?:$|\?)/i.test(loc)) continue;
        try {
          const normalized = normalizeUrl(loc);
          if (normalizeHostname(new URL(normalized).hostname) === normalizeHostname(new URL(rootUrl).hostname)) {
            sitemapUrls.add(normalized);
          }
        } catch {
          // Ignore malformed sitemap entries.
        }
      }
    } catch {
      // A missing sitemap does not fail the audit.
    }
  }

  return {
    robotsAccessible,
    sitemapFound,
    sitemapUrls: [...sitemapUrls]
  };
}

async function runPageSpeed(url, strategy) {
  const key = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (!key) return null;

  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("key", key);
  for (const category of ["PERFORMANCE", "ACCESSIBILITY", "SEO", "BEST_PRACTICES"]) {
    endpoint.searchParams.append("category", category);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) {
      throw new Error("PageSpeed API returned HTTP " + response.status + ".");
    }
    const data = await response.json();
    const lighthouse = data.lighthouseResult || {};
    const audits = lighthouse.audits || {};
    const categories = lighthouse.categories || {};
    const field = data.loadingExperience?.metrics || {};

    return {
      strategy,
      performanceScore: Number.isFinite(categories.performance?.score)
        ? Math.round(categories.performance.score * 100)
        : null,
      accessibilityScore: Number.isFinite(categories.accessibility?.score)
        ? Math.round(categories.accessibility.score * 100)
        : null,
      seoScore: Number.isFinite(categories.seo?.score)
        ? Math.round(categories.seo.score * 100)
        : null,
      bestPracticesScore: Number.isFinite(categories["best-practices"]?.score)
        ? Math.round(categories["best-practices"].score * 100)
        : null,
      lab: {
        lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
        cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
        fcpMs: audits["first-contentful-paint"]?.numericValue ?? null,
        tbtMs: audits["total-blocking-time"]?.numericValue ?? null,
        speedIndexMs: audits["speed-index"]?.numericValue ?? null
      },
      field: {
        lcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
        inpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
        cls: Number.isFinite(field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile)
          ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100
          : null,
        fcpMs: field.FIRST_CONTENTFUL_PAINT_MS?.percentile ?? null,
        ttfbMs: field.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile ?? null
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildFinding(area, severity, finding, businessImplication, confidence, evidence) {
  return {
    area,
    severity,
    finding,
    businessImplication,
    confidence: Math.round(clamp(confidence)),
    evidence: evidence.slice(0, 6)
  };
}

function scoreFreshness(pages, rootText) {
  const dated = pages.filter((page) => Number.isFinite(page.estimatedContentAgeDays));
  const articles = pages.filter((page) => page.pageType === "article");
  const ages = dated.map((page) => page.estimatedContentAgeDays).sort((a, b) => a - b);
  const newestAge = ages.length ? ages[0] : null;
  const medianAge = ages.length ? ages[Math.floor(ages.length / 2)] : null;
  const stale = dated.filter((page) => page.contentStale).length;
  const staleRatio = dated.length ? stale / dated.length : null;
  const copyrightYears = [...rootText.matchAll(/(?:©|copyright)\s*(?:19|20)?(\d{2,4})/gi)]
    .map((match) => Number(match[1].length === 2 ? "20" + match[1] : match[1]))
    .filter((year) => year >= 1990 && year <= new Date().getFullYear());
  const latestCopyrightYear = copyrightYears.length ? Math.max(...copyrightYears) : null;

  let score = null;
  if (dated.length) {
    score = 100;
    if (newestAge > 730) score -= 30;
    else if (newestAge > 365) score -= 15;
    if (medianAge > 1460) score -= 25;
    else if (medianAge > 730) score -= 12;
    if (staleRatio > 0.5) score -= 20;
    else if (staleRatio > 0.25) score -= 10;
  } else if (articles.length) {
    score = 45;
  } else if (latestCopyrightYear && latestCopyrightYear < new Date().getFullYear() - 1) {
    score = 55;
  }

  return {
    score: score === null ? null : clamp(score),
    newestContentAgeDays: newestAge,
    medianContentAgeDays: medianAge,
    datedPages: dated.length,
    stalePages: stale,
    staleRatio: staleRatio === null ? null : round1(staleRatio * 100),
    articlePagesSampled: articles.length,
    latestCopyrightYear
  };
}

function buildSiteScores(pages, pageSpeed, rootHtml) {
  const validPages = pages.filter((page) => page.httpStatus < 500);
  const servicePages = validPages.filter((page) => page.pageType === "service");
  const titles = validPages.map((page) => page.title).filter(Boolean);
  const duplicateTitles = titles.length - new Set(titles.map((item) => item.toLowerCase())).size;
  const missingH1 = validPages.filter((page) => page.h1Count === 0).length;
  const multiH1 = validPages.filter((page) => page.h1Count > 1).length;
  const canonicalCoverage = validPages.length
    ? validPages.filter((page) => page.canonical).length / validPages.length
    : 0;
  const ctaPages = validPages.filter((page) => page.primaryCta).length;
  const serviceCtaPages = servicePages.filter((page) => page.primaryCta).length;
  const altImages = validPages.reduce((sum, page) => sum + page.images, 0);
  const missingAlt = validPages.reduce((sum, page) => sum + page.missingAltImages, 0);
  const schemaTypes = [...new Set(validPages.flatMap((page) => page.schemaTypes))];

  let structure = 100;
  structure -= Math.min(25, missingH1 * 6);
  structure -= Math.min(12, multiH1 * 3);
  structure -= Math.min(15, validPages.reduce((sum, page) => sum + page.headingOrderIssues, 0) * 2);
  structure -= Math.min(12, duplicateTitles * 4);
  if (average(validPages.map((page) => page.internalLinks)) < 4) structure -= 12;

  const conversionBase = servicePages.length ? servicePages : validPages;
  const conversion = average(conversionBase.map((page) => page.conversionScore));
  const technicalSeo = average(validPages.map((page) => page.technicalSeoScore));

  let mobile = null;
  const mobilePsi = pageSpeed?.mobile || null;
  const viewportCoverage = validPages.length
    ? validPages.filter((page) => page.hasViewport).length / validPages.length
    : 0;
  if (mobilePsi?.performanceScore !== null && mobilePsi?.performanceScore !== undefined) {
    mobile = mobilePsi.performanceScore * 0.65 + viewportCoverage * 100 * 0.35;
  } else if (validPages.length) {
    mobile = viewportCoverage * 100;
  }

  const performance = average([
    pageSpeed?.mobile?.performanceScore,
    pageSpeed?.desktop?.performanceScore
  ]);

  let accessibility = average([
    pageSpeed?.mobile?.accessibilityScore,
    pageSpeed?.desktop?.accessibilityScore
  ]);
  if (accessibility === null && altImages > 0) {
    accessibility = clamp(100 - (missingAlt / altImages) * 60);
  }

  let structuredData = 20;
  if (schemaTypes.length) structuredData += 25;
  if (schemaTypes.some((type) => /Organization|LocalBusiness|Dentist|LegalService|ProfessionalService/i.test(type))) structuredData += 25;
  if (schemaTypes.some((type) => /BreadcrumbList/i.test(type))) structuredData += 15;
  if (schemaTypes.some((type) => /Service|Article|Person|FAQPage/i.test(type))) structuredData += 15;

  const rootTech = validPages[0]?.technology || {};
  let platformHealth = 60;
  if (rootTech.cmsDetected) platformHealth += 8;
  if (rootTech.cmsVersionDetected) platformHealth += 4;
  const jquery = (rootTech.libraries || []).find((item) => item.name === "jQuery");
  if (jquery?.version && /^1\.|^2\./.test(jquery.version)) platformHealth -= 25;
  if ((rootTech.libraries || []).some((item) => ["Next.js", "Nuxt"].includes(item.name))) platformHealth += 8;

  const types = new Set(validPages.map((page) => page.pageType));
  let trust = 35;
  if (types.has("about_team")) trust += 20;
  if (types.has("contact")) trust += 10;
  if (validPages.some((page) => page.textSignals.hasTestimonials)) trust += 15;
  if (validPages.some((page) => page.textSignals.hasAwards)) trust += 10;
  if (validPages.some((page) => page.textSignals.hasTeamLanguage)) trust += 10;

  let ai = 35;
  if (validPages[0]?.title && validPages[0]?.h1) ai += 12;
  if (types.has("service")) ai += 15;
  if (types.has("about_team")) ai += 10;
  if (types.has("location")) ai += 8;
  if (schemaTypes.length) ai += 10;
  if (validPages.some((page) => page.textSignals.hasLocationLanguage)) ai += 5;
  if (validPages.some((page) => page.textSignals.hasServiceLanguage)) ai += 5;

  const freshness = scoreFreshness(validPages, stripTags(rootHtml));

  return {
    contentFreshness: freshness,
    siteStructure: {
      score: clamp(structure),
      missingH1Pages: missingH1,
      multipleH1Pages: multiH1,
      duplicateTitles,
      canonicalCoverage: round1(canonicalCoverage * 100),
      internalLinksAverage: round1(average(validPages.map((page) => page.internalLinks)) || 0)
    },
    conversion: {
      score: conversion === null ? null : round1(conversion),
      ctaCoverage: validPages.length ? round1((ctaPages / validPages.length) * 100) : null,
      serviceCtaCoverage: servicePages.length ? round1((serviceCtaPages / servicePages.length) * 100) : null,
      formsDetected: validPages.reduce((sum, page) => sum + page.forms, 0)
    },
    technicalSeo: {
      score: technicalSeo === null ? null : round1(technicalSeo),
      canonicalCoverage: round1(canonicalCoverage * 100),
      duplicateTitles,
      missingH1Pages: missingH1
    },
    performance: {
      score: performance === null ? null : round1(performance),
      mobile: pageSpeed?.mobile || null,
      desktop: pageSpeed?.desktop || null
    },
    mobile: {
      score: mobile === null ? null : round1(mobile),
      viewportCoverage: round1(viewportCoverage * 100)
    },
    accessibility: {
      score: accessibility === null ? null : round1(accessibility),
      missingAltImages: missingAlt,
      totalImages: altImages,
      automatedOnly: true
    },
    structuredData: {
      score: clamp(structuredData),
      schemaTypes
    },
    platform: {
      score: clamp(platformHealth),
      ...rootTech,
      updateRisk: jquery?.version && /^1\.|^2\./.test(jquery.version) ? "moderate" : "unknown",
      versionCurrencyVerified: false
    },
    trust: {
      score: clamp(trust),
      aboutTeamPageDetected: types.has("about_team"),
      contactPageDetected: types.has("contact"),
      testimonialSignals: validPages.some((page) => page.textSignals.hasTestimonials),
      awardSignals: validPages.some((page) => page.textSignals.hasAwards)
    },
    aiDiscoverability: {
      score: clamp(ai),
      proprietaryDiagnostic: true,
      serviceArchitectureDetected: types.has("service"),
      entityAboutPageDetected: types.has("about_team"),
      locationArchitectureDetected: types.has("location"),
      structuredDataPresent: schemaTypes.length > 0
    }
  };
}

function buildHygiene(rootResult) {
  const url = new URL(rootResult.url);
  const headers = rootResult.headers;
  return {
    score: clamp(
      40 +
        (url.protocol === "https:" ? 25 : 0) +
        (headers.get("strict-transport-security") ? 10 : 0) +
        (headers.get("content-security-policy") ? 10 : 0) +
        (headers.get("x-content-type-options") ? 8 : 0) +
        (headers.get("referrer-policy") ? 7 : 0)
    ),
    httpsEnabled: url.protocol === "https:",
    hstsPresent: Boolean(headers.get("strict-transport-security")),
    cspPresent: Boolean(headers.get("content-security-policy")),
    xContentTypeOptionsPresent: Boolean(headers.get("x-content-type-options")),
    referrerPolicyPresent: Boolean(headers.get("referrer-policy"))
  };
}

function websiteHealth(scores, hygiene) {
  const weighted = [
    [scores.contentFreshness.score, 10],
    [scores.siteStructure.score, 15],
    [scores.conversion.score, 20],
    [scores.technicalSeo.score, 10],
    [scores.performance.score, 10],
    [scores.mobile.score, 5],
    [scores.accessibility.score, 5],
    [scores.structuredData.score, 5],
    [scores.platform.score, 8],
    [scores.trust.score, 5],
    [scores.aiDiscoverability.score, 5],
    [hygiene.score, 2]
  ].filter(([score]) => Number.isFinite(score));

  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  if (!totalWeight) return null;
  return round1(weighted.reduce((sum, [score, weight]) => sum + score * weight, 0) / totalWeight);
}

function buildFindings(scores, hygiene, pages) {
  const findings = [];
  const rootUrl = pages[0]?.url;
  const evidence = rootUrl ? [{ url: rootUrl, fact: "First-party website measurement." }] : [];

  if (Number.isFinite(scores.contentFreshness.score) && scores.contentFreshness.score < 60) {
    findings.push(buildFinding(
      "content_freshness",
      "medium",
      "The sampled website shows weak content-freshness signals.",
      "Older or inactive content can make current expertise and offerings harder to demonstrate in search and buyer evaluation.",
      88,
      evidence
    ));
  }

  if (Number.isFinite(scores.conversion.score) && scores.conversion.score < 65) {
    findings.push(buildFinding(
      "conversion",
      "high",
      "Important sampled pages have inconsistent or weak conversion paths.",
      "Qualified visitors may need extra steps to call, book, request a quote, or start a conversation.",
      92,
      pages.filter((page) => !page.primaryCta).slice(0, 3).map((page) => ({
        url: page.url,
        fact: "No clear primary CTA detected on this sampled page."
      }))
    ));
  }

  if (scores.siteStructure.score < 70) {
    findings.push(buildFinding(
      "site_structure",
      "medium",
      "The sampled site architecture has heading, title, or internal-navigation weaknesses.",
      "Clearer information architecture can make priority services easier for both buyers and search systems to understand.",
      90,
      evidence
    ));
  }

  if (scores.technicalSeo.score !== null && scores.technicalSeo.score < 70) {
    findings.push(buildFinding(
      "technical_seo",
      "medium",
      "The sampled pages show technical SEO fundamentals that could be improved.",
      "Missing or inconsistent titles, headings, canonicals, or image metadata can reduce clarity and crawl efficiency.",
      90,
      evidence
    ));
  }

  if (scores.structuredData.score < 55) {
    findings.push(buildFinding(
      "structured_data",
      "low",
      "Limited structured-data coverage was detected on sampled pages.",
      "Accurate structured data can help search systems understand the business, services, people, and page relationships.",
      82,
      evidence
    ));
  }

  if (scores.platform.updateRisk === "moderate") {
    findings.push(buildFinding(
      "platform_health",
      "medium",
      "A legacy front-end library version was publicly detectable.",
      "Observable legacy technology can indicate modernization or maintenance work worth reviewing.",
      86,
      evidence
    ));
  }

  if (hygiene.score < 70) {
    findings.push(buildFinding(
      "site_hygiene",
      "low",
      "Several basic browser/security hygiene headers were not observable.",
      "This is not a vulnerability finding, but it can indicate an opportunity for a technical maintenance review.",
      80,
      evidence
    ));
  }

  return findings.slice(0, 12);
}

export async function runWebsiteAudit({ industry, prospect }) {
  const rootRequested = normalizeUrl(prospect.website);
  const rootHost = normalizeHostname(new URL(rootRequested).hostname);
  const root = await safeFetchText(rootRequested);

  if (root.status >= 500) {
    throw new Error("Website returned HTTP " + root.status + " during audit.");
  }

  const rootPage = extractPage(root.text, root.url, root.status, root.headers, rootHost);
  const crawlMeta = await fetchRobotsAndSitemap(root.url);

  const candidates = new Set([
    ...rootPage.links,
    ...crawlMeta.sitemapUrls
  ]);

  const selected = [...candidates]
    .filter((url) => url !== normalizeUrl(root.url))
    .sort((a, b) => pagePriority(b) - pagePriority(a))
    .slice(0, MAX_PAGES - 1);

  const pages = [rootPage];

  for (const url of selected) {
    try {
      const result = await safeFetchText(url);
      const contentType = result.headers.get("content-type") || "";
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) continue;
      pages.push(extractPage(result.text, result.url, result.status, result.headers, rootHost));
    } catch {
      // Individual page failures do not fail the site audit.
    }
  }

  let pageSpeed = null;
  let pageSpeedError = null;
  if (process.env.GOOGLE_PAGESPEED_API_KEY) {
    try {
      const [mobile, desktop] = await Promise.all([
        runPageSpeed(root.url, "mobile"),
        runPageSpeed(root.url, "desktop")
      ]);
      pageSpeed = { mobile, desktop };
    } catch (error) {
      pageSpeedError = String(error.message || error).slice(0, 500);
    }
  }

  const scores = buildSiteScores(pages, pageSpeed, root.text);
  const hygiene = buildHygiene(root);
  const health = websiteHealth(scores, hygiene);
  const findings = buildFindings(scores, hygiene, pages);
  const evidence = findings.flatMap((finding) => finding.evidence || []).slice(0, 30);

  const knownDimensions = [
    scores.contentFreshness.score,
    scores.siteStructure.score,
    scores.conversion.score,
    scores.technicalSeo.score,
    scores.performance.score,
    scores.mobile.score,
    scores.accessibility.score,
    scores.structuredData.score,
    scores.platform.score,
    scores.trust.score,
    scores.aiDiscoverability.score
  ].filter(Number.isFinite).length;

  const confidence = clamp(
    45 +
      Math.min(30, pages.length * 2) +
      Math.min(15, knownDimensions) +
      (crawlMeta.sitemapFound ? 5 : 0) +
      (pageSpeed ? 5 : 0)
  );

  return {
    industry,
    companyName: prospect.name,
    website: normalizeUrl(root.url),
    auditVersion: WEBSITE_AUDIT_VERSION,
    auditDepth: "standard",
    pagesDiscovered: candidates.size + 1,
    pagesSampled: pages.length,
    robotsAccessible: crawlMeta.robotsAccessible,
    sitemapFound: crawlMeta.sitemapFound,
    sitemapUrlsCount: crawlMeta.sitemapUrls.length,
    websiteHealthScore: health,
    scores: {
      contentFreshness: scores.contentFreshness.score,
      siteStructure: scores.siteStructure.score,
      conversion: scores.conversion.score,
      technicalSeo: scores.technicalSeo.score,
      performance: scores.performance.score,
      mobile: scores.mobile.score,
      accessibility: scores.accessibility.score,
      structuredData: scores.structuredData.score,
      platformHealth: scores.platform.score,
      trust: scores.trust.score,
      aiDiscoverability: scores.aiDiscoverability.score,
      siteHygiene: hygiene.score
    },
    contentFreshness: scores.contentFreshness,
    structure: scores.siteStructure,
    conversion: scores.conversion,
    technicalSeo: scores.technicalSeo,
    performance: scores.performance,
    mobile: scores.mobile,
    accessibility: scores.accessibility,
    structuredData: scores.structuredData,
    platform: scores.platform,
    siteHygiene: hygiene,
    trust: scores.trust,
    aiDiscoverability: scores.aiDiscoverability,
    findings,
    evidence,
    auditConfidence: Math.round(confidence),
    pageSpeedAvailable: Boolean(pageSpeed),
    pageSpeedError,
    auditedAt: new Date().toISOString(),
    pages: pages.map((page) => ({
      url: page.url,
      pageType: page.pageType,
      httpStatus: page.httpStatus,
      title: page.title,
      titleLength: page.titleLength,
      metaDescription: page.metaDescription,
      canonical: page.canonical,
      h1: page.h1,
      h1Count: page.h1Count,
      headingCount: page.headingCount,
      headingOrderIssues: page.headingOrderIssues,
      wordCount: page.wordCount,
      publishedDate: page.publishedDate,
      modifiedDate: page.modifiedDate,
      estimatedContentAgeDays: page.estimatedContentAgeDays,
      contentStale: page.contentStale,
      internalLinks: page.internalLinks,
      externalLinks: page.externalLinks,
      images: page.images,
      missingAltImages: page.missingAltImages,
      forms: page.forms,
      primaryCta: page.primaryCta,
      hasViewport: page.hasViewport,
      schemaTypes: page.schemaTypes,
      cmsSignals: page.cmsSignals,
      contentQualityScore: page.contentQualityScore,
      conversionScore: page.conversionScore,
      technicalSeoScore: page.technicalSeoScore,
      findings: [],
      evidence: [{ url: page.url, fact: "Direct first-party page measurement." }]
    }))
  };
}

export async function getOrRunWebsiteAudit({ industry, prospect }) {
  try {
    const recent = await getRecentWebsiteAudit({
      industry,
      website: prospect.website,
      auditVersion: WEBSITE_AUDIT_VERSION,
      maxAgeDays: CACHE_DAYS
    });
    if (recent) return { audit: recent, cached: true };
  } catch (error) {
    console.warn("Website audit cache lookup failed:", error.message);
  }

  const audit = await runWebsiteAudit({ industry, prospect });

  try {
    const saved = await saveWebsiteAudit(prospect, audit);
    return { audit: saved || audit, cached: false };
  } catch (error) {
    console.warn("Website audit persistence failed:", error.message);
    return { audit, cached: false, persistenceError: error.message };
  }
}
