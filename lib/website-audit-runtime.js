import dns from "node:dns/promises";
import net from "node:net";
import {
  getRecentWebsiteAudit,
  saveWebsiteAudit
} from "./website-audit-store.js";

export const WEBSITE_AUDIT_VERSION = "website-intelligence-v1";

const MAX_PAGES = Math.max(3, Math.min(20, Number(process.env.WEBSITE_AUDIT_MAX_PAGES || 15)));
const CACHE_DAYS = Math.max(1, Math.min(180, Number(process.env.WEBSITE_AUDIT_CACHE_DAYS || 30)));
const TIMEOUT_MS = Math.max(3000, Math.min(20000, Number(process.env.WEBSITE_AUDIT_FETCH_TIMEOUT_MS || 8000)));
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_AUX_BYTES = 1024 * 1024;

function clamp(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function avg(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function round1(value) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

function normalizeHost(value) {
  return String(value || "").toLowerCase().replace(/^www\./, "");
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function privateIpv4(address) {
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}

function privateAddress(address) {
  const type = net.isIP(address);
  if (type === 4) return privateIpv4(address);
  if (type !== 6) return true;
  const value = address.toLowerCase();
  if (value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value)) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? privateIpv4(mapped[1]) : false;
}

async function validatePublicUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only public HTTP(S) websites can be audited.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Website audit refused a non-public hostname.");
  }
  if (net.isIP(hostname)) {
    if (privateAddress(hostname)) throw new Error("Website audit refused a private address.");
    return url;
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address))) {
    throw new Error("Website audit refused a non-public network target.");
  }
  return url;
}

async function readBody(response, maxBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Website response exceeded audit size limit.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchText(value, maxBytes = MAX_HTML_BYTES) {
  let current = await validatePublicUrl(value);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "VIPWebsiteIntelligence/1.0",
          Accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.5"
        }
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect missing location.");
        current = await validatePublicUrl(new URL(location, current).toString());
        continue;
      }
      const text = await readBody(response, maxBytes);
      return { url: current.toString(), status: response.status, headers: response.headers, text };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Website audit exceeded redirect limit.");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}

function meta(html, key) {
  const safe = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${safe}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${safe}["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return stripHtml(match[1]);
  }
  return null;
}

function canonical(html, base) {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/\brel=["'][^"']*canonical/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)/i)?.[1];
    if (!href) continue;
    try { return new URL(href, base).toString(); } catch { return null; }
  }
  return null;
}

function schemas(html) {
  const found = new Set();
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (value["@type"]) {
      const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
      types.forEach((type) => found.add(String(type)));
    }
    Object.values(value).forEach(visit);
  };
  for (const script of scripts.slice(0, 20)) {
    try {
      visit(JSON.parse(script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "")));
    } catch {}
  }
  return [...found].slice(0, 40);
}

function technology(html) {
  const lower = html.toLowerCase();
  const generator = meta(html, "generator");
  const signals = [];
  let cmsDetected = null;
  let cmsConfidence = null;
  let cmsVersionDetected = null;
  const set = (name, confidence, signal) => {
    if (!cmsConfidence || confidence > cmsConfidence) {
      cmsDetected = name;
      cmsConfidence = confidence;
    }
    signals.push(signal);
  };
  if (lower.includes("/wp-content/") || lower.includes("/wp-includes/")) set("WordPress", 98, "WordPress asset paths detected");
  if (lower.includes("wixstatic.com")) set("Wix", 96, "Wix assets detected");
  if (lower.includes("squarespace-cdn.com") || lower.includes("static1.squarespace.com")) set("Squarespace", 96, "Squarespace assets detected");
  if (lower.includes("cdn.shopify.com")) set("Shopify", 96, "Shopify assets detected");
  if (lower.includes("data-wf-page") || lower.includes("webflow.io")) set("Webflow", 95, "Webflow signatures detected");
  if (lower.includes("hubspotusercontent") || lower.includes("hs-scripts.com")) set("HubSpot CMS", 92, "HubSpot CMS signatures detected");
  if (generator) {
    signals.push("Generator: " + generator);
    const wp = generator.match(/wordpress\s*([0-9.]+)?/i);
    if (wp) { set("WordPress", 100, "WordPress generator metadata"); cmsVersionDetected = wp[1] || null; }
    const drupal = generator.match(/drupal\s*([0-9.]+)?/i);
    if (drupal) { set("Drupal", 100, "Drupal generator metadata"); cmsVersionDetected = drupal[1] || null; }
  }
  const libraries = [];
  const jquery = html.match(/jquery(?:\.min)?[-.]([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
  if (jquery) libraries.push({ name: "jQuery", version: jquery[1] });
  if (lower.includes("__next_data__") || lower.includes("/_next/")) libraries.push({ name: "Next.js", version: null });
  if (lower.includes("__nuxt__") || lower.includes("/_nuxt/")) libraries.push({ name: "Nuxt", version: null });
  return { cmsDetected, cmsConfidence, cmsVersionDetected, generator, libraries, signals: [...new Set(signals)].slice(0, 12) };
}

function typeFor(url) {
  const path = new URL(url).pathname.toLowerCase();
  if (path === "/" || !path) return "homepage";
  if (/(contact|book|appointment|schedule)/.test(path)) return "contact";
  if (/(about|team|staff|doctor|attorney|leadership|people)/.test(path)) return "about_team";
  if (/(blog|news|article|insights|resources)/.test(path)) return "article";
  if (/(location|office|areas-we-serve)/.test(path)) return "location";
  if (/(service|implant|cosmetic|roof|hvac|plumb|law|machin|fabricat|remodel|injury|estate)/.test(path)) return "service";
  return "other";
}

function priority(url) {
  return { homepage: 100, service: 90, contact: 85, about_team: 80, location: 75, article: 65, other: 40 }[typeFor(url)] || 40;
}

function links(html, base, host) {
  const output = [];
  for (const tag of html.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/gi) || []) {
    const href = tag.match(/href=["']([^"']+)/i)?.[1];
    if (!href || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const url = new URL(href, base);
      if (normalizeHost(url.hostname) !== host) continue;
      output.push(normalizeUrl(url.toString()));
    } catch {}
  }
  return [...new Set(output)];
}

function datesFrom(html) {
  const values = [meta(html, "article:published_time"), meta(html, "article:modified_time"), meta(html, "datePublished"), meta(html, "dateModified")].filter(Boolean);
  for (const tag of (html.match(/<time\b[^>]*datetime=["'][^"']+["'][^>]*>/gi) || []).slice(0, 5)) {
    const value = tag.match(/datetime=["']([^"']+)/i)?.[1];
    if (value) values.push(value);
  }
  return values.map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime()) && date <= new Date());
}

function inspectPage(result, rootHost) {
  const html = result.text;
  const title = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") || null;
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: stripHtml(m[2]) }));
  const h1s = headings.filter((h) => h.level === 1);
  let headingOrderIssues = 0;
  for (let i = 1; i < headings.length; i += 1) if (headings[i].level - headings[i - 1].level > 1) headingOrderIssues += 1;
  const text = stripHtml(html);
  const internal = links(html, result.url, rootHost);
  const imageTags = html.match(/<img\b[^>]*>/gi) || [];
  const missingAlt = imageTags.filter((tag) => !/\balt=["'][^"']+["']/i.test(tag)).length;
  const forms = (html.match(/<form\b/gi) || []).length;
  const cta = [...html.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)]
    .map((m) => stripHtml(m[1]))
    .find((value) => /\b(book|schedule|appointment|consult|contact|get (?:a )?quote|request|call|estimate|demo|start)\b/i.test(value)) || null;
  const pageDates = datesFrom(html);
  const recentDate = pageDates.length ? new Date(Math.max(...pageDates.map((d) => d.getTime()))) : null;
  const age = recentDate ? Math.max(0, Math.round((Date.now() - recentDate.getTime()) / 86400000)) : null;
  const pageType = typeFor(result.url);
  const schemaTypes = schemas(html);
  const tech = technology(html);
  let seo = 100;
  if (!title) seo -= 20;
  if (!meta(html, "description")) seo -= 12;
  if (h1s.length !== 1) seo -= 15;
  if (!canonical(html, result.url)) seo -= 10;
  if (result.status >= 400) seo -= 30;
  if (imageTags.length && missingAlt / imageTags.length > 0.25) seo -= 8;
  let conversion = 45 + (cta ? 25 : 0) + (forms ? 12 : 0) + (/href=["']tel:/i.test(html) ? 8 : 0) + (/\b(financ|payment|estimate|quote)\b/i.test(text) ? 5 : 0);
  let content = 45 + (text.split(/\s+/).length >= (pageType === "article" ? 700 : 350) ? 20 : 0) + (headings.length >= 3 ? 10 : 0) + (title && h1s.length === 1 ? 10 : 0) + (schemaTypes.length ? 5 : 0);
  return {
    url: result.url, pageType, httpStatus: result.status, title, titleLength: title?.length || 0,
    metaDescription: meta(html, "description"), canonical: canonical(html, result.url), h1: h1s[0]?.text || null,
    h1Count: h1s.length, headingCount: headings.length, headingOrderIssues,
    wordCount: text ? text.split(/\s+/).length : 0, publishedDate: null,
    modifiedDate: recentDate?.toISOString() || null, estimatedContentAgeDays: age,
    contentStale: age !== null && ((pageType === "article" && age > 730) || (pageType !== "article" && age > 1460)),
    internalLinks: internal.length, externalLinks: 0, images: imageTags.length, missingAltImages: missingAlt,
    forms, primaryCta: cta, hasViewport: Boolean(meta(html, "viewport")), schemaTypes,
    cmsSignals: tech.signals, contentQualityScore: clamp(content), conversionScore: clamp(conversion), technicalSeoScore: clamp(seo),
    links: internal, technology: tech, rawText: text
  };
}

async function crawlMeta(rootUrl) {
  const origin = new URL(rootUrl).origin;
  let robotsAccessible = null;
  let sitemapFound = false;
  const urls = new Set();
  const sitemaps = new Set([new URL("/sitemap.xml", origin).toString()]);
  try {
    const robots = await fetchText(new URL("/robots.txt", origin).toString(), MAX_AUX_BYTES);
    robotsAccessible = robots.status < 400;
    for (const m of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) sitemaps.add(m[1]);
  } catch { robotsAccessible = false; }
  for (const sitemap of [...sitemaps].slice(0, 4)) {
    try {
      const result = await fetchText(sitemap, MAX_AUX_BYTES);
      if (result.status >= 400 || !/<(?:urlset|sitemapindex)\b/i.test(result.text)) continue;
      sitemapFound = true;
      for (const m of [...result.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].slice(0, 500)) {
        if (/\.xml(?:$|\?)/i.test(m[1])) continue;
        try { urls.add(normalizeUrl(m[1])); } catch {}
      }
    } catch {}
  }
  return { robotsAccessible, sitemapFound, sitemapUrls: [...urls] };
}

async function pageSpeed(url, strategy) {
  const key = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (!key) return null;
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url); endpoint.searchParams.set("strategy", strategy); endpoint.searchParams.set("key", key);
  ["PERFORMANCE", "ACCESSIBILITY", "SEO", "BEST_PRACTICES"].forEach((c) => endpoint.searchParams.append("category", c));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) throw new Error("PageSpeed HTTP " + response.status);
    const data = await response.json();
    const categories = data.lighthouseResult?.categories || {};
    const audits = data.lighthouseResult?.audits || {};
    const field = data.loadingExperience?.metrics || {};
    return {
      strategy,
      performanceScore: Number.isFinite(categories.performance?.score) ? Math.round(categories.performance.score * 100) : null,
      accessibilityScore: Number.isFinite(categories.accessibility?.score) ? Math.round(categories.accessibility.score * 100) : null,
      seoScore: Number.isFinite(categories.seo?.score) ? Math.round(categories.seo.score * 100) : null,
      lab: { lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null, cls: audits["cumulative-layout-shift"]?.numericValue ?? null, fcpMs: audits["first-contentful-paint"]?.numericValue ?? null, tbtMs: audits["total-blocking-time"]?.numericValue ?? null },
      field: { lcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null, inpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null, cls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile ?? null, ttfbMs: field.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile ?? null }
    };
  } finally { clearTimeout(timer); }
}

function scoreAudit(pages, psi, rootResult) {
  const valid = pages.filter((p) => p.httpStatus < 500);
  const services = valid.filter((p) => p.pageType === "service");
  const dated = valid.filter((p) => Number.isFinite(p.estimatedContentAgeDays));
  const ages = dated.map((p) => p.estimatedContentAgeDays).sort((a, b) => a - b);
  let freshness = null;
  if (ages.length) {
    freshness = 100;
    if (ages[0] > 730) freshness -= 30; else if (ages[0] > 365) freshness -= 15;
    if (ages[Math.floor(ages.length / 2)] > 1460) freshness -= 25; else if (ages[Math.floor(ages.length / 2)] > 730) freshness -= 12;
    const staleRatio = dated.filter((p) => p.contentStale).length / dated.length;
    if (staleRatio > 0.5) freshness -= 20; else if (staleRatio > 0.25) freshness -= 10;
  }
  const missingH1 = valid.filter((p) => !p.h1Count).length;
  const multipleH1 = valid.filter((p) => p.h1Count > 1).length;
  const duplicateTitles = valid.map((p) => p.title).filter(Boolean).length - new Set(valid.map((p) => p.title?.toLowerCase()).filter(Boolean)).size;
  let structure = 100 - Math.min(25, missingH1 * 6) - Math.min(12, multipleH1 * 3) - Math.min(12, duplicateTitles * 4) - Math.min(15, valid.reduce((sum, p) => sum + p.headingOrderIssues, 0) * 2);
  const conversion = avg((services.length ? services : valid).map((p) => p.conversionScore));
  const seo = avg(valid.map((p) => p.technicalSeoScore));
  const performance = avg([psi?.mobile?.performanceScore, psi?.desktop?.performanceScore]);
  const viewport = valid.length ? valid.filter((p) => p.hasViewport).length / valid.length : 0;
  const mobile = psi?.mobile?.performanceScore != null ? psi.mobile.performanceScore * 0.65 + viewport * 35 : viewport * 100;
  const totalImages = valid.reduce((sum, p) => sum + p.images, 0);
  const missingAlt = valid.reduce((sum, p) => sum + p.missingAltImages, 0);
  const accessibility = avg([psi?.mobile?.accessibilityScore, psi?.desktop?.accessibilityScore]) ?? (totalImages ? 100 - (missingAlt / totalImages) * 60 : null);
  const schemaTypes = [...new Set(valid.flatMap((p) => p.schemaTypes))];
  let structured = 20 + (schemaTypes.length ? 25 : 0) + (schemaTypes.some((t) => /Organization|LocalBusiness|Dentist|LegalService|ProfessionalService/i.test(t)) ? 25 : 0) + (schemaTypes.some((t) => /BreadcrumbList/i.test(t)) ? 15 : 0) + (schemaTypes.some((t) => /Service|Article|Person|FAQPage/i.test(t)) ? 15 : 0);
  const tech = valid[0]?.technology || {};
  const jq = (tech.libraries || []).find((l) => l.name === "jQuery");
  let platform = 60 + (tech.cmsDetected ? 8 : 0) + (tech.cmsVersionDetected ? 4 : 0) + ((tech.libraries || []).some((l) => ["Next.js", "Nuxt"].includes(l.name)) ? 8 : 0) - (jq?.version && /^1\.|^2\./.test(jq.version) ? 25 : 0);
  const types = new Set(valid.map((p) => p.pageType));
  let trust = 35 + (types.has("about_team") ? 20 : 0) + (types.has("contact") ? 10 : 0) + (valid.some((p) => /\b(testimonial|reviews?)\b/i.test(p.rawText)) ? 15 : 0) + (valid.some((p) => /\b(award|recognized|accredit)\b/i.test(p.rawText)) ? 10 : 0);
  let ai = 35 + (valid[0]?.title && valid[0]?.h1 ? 12 : 0) + (types.has("service") ? 15 : 0) + (types.has("about_team") ? 10 : 0) + (types.has("location") ? 8 : 0) + (schemaTypes.length ? 10 : 0);
  const headers = rootResult.headers;
  const hygiene = clamp(40 + (new URL(rootResult.url).protocol === "https:" ? 25 : 0) + (headers.get("strict-transport-security") ? 10 : 0) + (headers.get("content-security-policy") ? 10 : 0) + (headers.get("x-content-type-options") ? 8 : 0) + (headers.get("referrer-policy") ? 7 : 0));
  const scores = { contentFreshness: freshness == null ? null : clamp(freshness), siteStructure: clamp(structure), conversion: round1(conversion), technicalSeo: round1(seo), performance: round1(performance), mobile: round1(mobile), accessibility: round1(accessibility), structuredData: clamp(structured), platformHealth: clamp(platform), trust: clamp(trust), aiDiscoverability: clamp(ai), siteHygiene: hygiene };
  const weighted = [[scores.contentFreshness,10],[scores.siteStructure,15],[scores.conversion,20],[scores.technicalSeo,10],[scores.performance,10],[scores.mobile,5],[scores.accessibility,5],[scores.structuredData,5],[scores.platformHealth,8],[scores.trust,5],[scores.aiDiscoverability,5],[scores.siteHygiene,2]].filter(([v]) => Number.isFinite(v));
  const weight = weighted.reduce((sum, [, w]) => sum + w, 0);
  const health = weight ? round1(weighted.reduce((sum,[v,w]) => sum + v*w,0) / weight) : null;
  return {
    scores, health,
    contentFreshness: { score: scores.contentFreshness, newestContentAgeDays: ages[0] ?? null, medianContentAgeDays: ages.length ? ages[Math.floor(ages.length/2)] : null, datedPages: dated.length, stalePages: dated.filter((p) => p.contentStale).length },
    structure: { score: scores.siteStructure, missingH1Pages: missingH1, multipleH1Pages: multipleH1, duplicateTitles },
    conversion: { score: scores.conversion, ctaCoverage: valid.length ? round1(valid.filter((p) => p.primaryCta).length / valid.length * 100) : null, serviceCtaCoverage: services.length ? round1(services.filter((p) => p.primaryCta).length / services.length * 100) : null },
    technicalSeo: { score: scores.technicalSeo, missingH1Pages: missingH1, duplicateTitles },
    performance: { score: scores.performance, mobile: psi?.mobile || null, desktop: psi?.desktop || null },
    mobile: { score: scores.mobile, viewportCoverage: round1(viewport * 100) },
    accessibility: { score: scores.accessibility, missingAltImages: missingAlt, totalImages, automatedOnly: true },
    structuredData: { score: scores.structuredData, schemaTypes },
    platform: { score: scores.platformHealth, ...tech, updateRisk: jq?.version && /^1\.|^2\./.test(jq.version) ? "moderate" : "unknown", versionCurrencyVerified: false },
    siteHygiene: { score: hygiene, httpsEnabled: new URL(rootResult.url).protocol === "https:", hstsPresent: Boolean(headers.get("strict-transport-security")), cspPresent: Boolean(headers.get("content-security-policy")), xContentTypeOptionsPresent: Boolean(headers.get("x-content-type-options")), referrerPolicyPresent: Boolean(headers.get("referrer-policy")) },
    trust: { score: scores.trust, aboutTeamPageDetected: types.has("about_team"), contactPageDetected: types.has("contact") },
    aiDiscoverability: { score: scores.aiDiscoverability, proprietaryDiagnostic: true, serviceArchitectureDetected: types.has("service"), entityAboutPageDetected: types.has("about_team"), locationArchitectureDetected: types.has("location"), structuredDataPresent: schemaTypes.length > 0 }
  };
}

function findingsFrom(scored, pages) {
  const f = [];
  const evidence = pages[0] ? [{ url: pages[0].url, fact: "Direct first-party website measurement." }] : [];
  const add = (area, severity, finding, businessImplication, confidence, custom = evidence) => f.push({ area, severity, finding, businessImplication, confidence, evidence: custom.slice(0, 4) });
  if (scored.scores.contentFreshness != null && scored.scores.contentFreshness < 60) add("content_freshness","medium","The sampled site shows weak content-freshness signals.","Older or inactive content can make current expertise harder to demonstrate in search and buyer evaluation.",88);
  if (scored.scores.conversion != null && scored.scores.conversion < 65) add("conversion","high","Important sampled pages have weak or inconsistent conversion paths.","Qualified visitors may need extra steps to call, book, request a quote, or start a conversation.",92,pages.filter((p)=>!p.primaryCta).slice(0,3).map((p)=>({url:p.url,fact:"No clear primary CTA detected."})));
  if (scored.scores.siteStructure < 70) add("site_structure","medium","The sampled information architecture has structural weaknesses.","Clearer page hierarchy can make priority services easier for buyers and search systems to understand.",90);
  if (scored.scores.technicalSeo != null && scored.scores.technicalSeo < 70) add("technical_seo","medium","The sampled pages show technical SEO fundamentals that could be improved.","Titles, headings, canonicals, and image metadata affect clarity and crawl efficiency.",90);
  if (scored.scores.structuredData < 55) add("structured_data","low","Limited structured-data coverage was detected.","Accurate structured data can improve machine understanding of the business, services, people, and page relationships.",82);
  if (scored.platform.updateRisk === "moderate") add("platform_health","medium","A legacy front-end library version was publicly detectable.","Observable legacy technology can justify a maintenance or modernization review.",86);
  return f.slice(0,12);
}

export async function runWebsiteAudit({ industry, prospect }) {
  const requested = normalizeUrl(prospect.website);
  const rootHost = normalizeHost(new URL(requested).hostname);
  const root = await fetchText(requested);
  if (root.status >= 500) throw new Error("Website returned HTTP " + root.status + " during audit.");
  const rootPage = inspectPage(root, rootHost);
  const metaInfo = await crawlMeta(root.url);
  const candidates = new Set([...rootPage.links, ...metaInfo.sitemapUrls].filter((url) => { try { return normalizeHost(new URL(url).hostname) === rootHost; } catch { return false; } }));
  const selected = [...candidates].filter((url) => url !== normalizeUrl(root.url)).sort((a,b)=>priority(b)-priority(a)).slice(0,MAX_PAGES-1);
  const pages = [rootPage];
  for (const url of selected) {
    try {
      const result = await fetchText(url);
      const type = result.headers.get("content-type") || "";
      if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) continue;
      pages.push(inspectPage(result, rootHost));
    } catch {}
  }
  let psi = null;
  let pageSpeedError = null;
  if (process.env.GOOGLE_PAGESPEED_API_KEY) {
    try {
      const [mobile, desktop] = await Promise.all([pageSpeed(root.url,"mobile"), pageSpeed(root.url,"desktop")]);
      psi = { mobile, desktop };
    } catch (error) { pageSpeedError = String(error.message || error).slice(0,500); }
  }
  const scored = scoreAudit(pages, psi, root);
  const findings = findingsFrom(scored, pages);
  const known = Object.values(scored.scores).filter(Number.isFinite).length;
  const confidence = clamp(45 + Math.min(30,pages.length*2) + Math.min(15,known) + (metaInfo.sitemapFound?5:0) + (psi?5:0));
  return {
    industry, companyName: prospect.name, website: normalizeUrl(root.url), auditVersion: WEBSITE_AUDIT_VERSION,
    auditDepth: "standard", pagesDiscovered: candidates.size + 1, pagesSampled: pages.length,
    robotsAccessible: metaInfo.robotsAccessible, sitemapFound: metaInfo.sitemapFound, sitemapUrlsCount: metaInfo.sitemapUrls.length,
    websiteHealthScore: scored.health, scores: scored.scores, contentFreshness: scored.contentFreshness,
    structure: scored.structure, conversion: scored.conversion, technicalSeo: scored.technicalSeo,
    performance: scored.performance, mobile: scored.mobile, accessibility: scored.accessibility,
    structuredData: scored.structuredData, platform: scored.platform, siteHygiene: scored.siteHygiene,
    trust: scored.trust, aiDiscoverability: scored.aiDiscoverability, findings,
    evidence: findings.flatMap((item)=>item.evidence||[]).slice(0,30), auditConfidence: Math.round(confidence),
    pageSpeedAvailable: Boolean(psi), pageSpeedError, auditedAt: new Date().toISOString(),
    pages: pages.map((p)=>({ url:p.url,pageType:p.pageType,httpStatus:p.httpStatus,title:p.title,titleLength:p.titleLength,metaDescription:p.metaDescription,canonical:p.canonical,h1:p.h1,h1Count:p.h1Count,headingCount:p.headingCount,headingOrderIssues:p.headingOrderIssues,wordCount:p.wordCount,publishedDate:p.publishedDate,modifiedDate:p.modifiedDate,estimatedContentAgeDays:p.estimatedContentAgeDays,contentStale:p.contentStale,internalLinks:p.internalLinks,externalLinks:p.externalLinks,images:p.images,missingAltImages:p.missingAltImages,forms:p.forms,primaryCta:p.primaryCta,hasViewport:p.hasViewport,schemaTypes:p.schemaTypes,cmsSignals:p.cmsSignals,contentQualityScore:p.contentQualityScore,conversionScore:p.conversionScore,technicalSeoScore:p.technicalSeoScore,findings:[],evidence:[{url:p.url,fact:"Direct first-party page measurement."}] }))
  };
}

export async function getOrRunWebsiteAudit({ industry, prospect }) {
  try {
    const cached = await getRecentWebsiteAudit({ industry, website: normalizeUrl(prospect.website), auditVersion: WEBSITE_AUDIT_VERSION, maxAgeDays: CACHE_DAYS });
    if (cached) return { audit: cached, cached: true };
  } catch (error) { console.warn("Website audit cache lookup failed:", error.message); }
  const audit = await runWebsiteAudit({ industry, prospect });
  try {
    const saved = await saveWebsiteAudit(prospect, audit);
    return { audit: saved || audit, cached: false };
  } catch (error) {
    console.warn("Website audit persistence failed:", error.message);
    return { audit, cached: false, persistenceError: error.message };
  }
}
