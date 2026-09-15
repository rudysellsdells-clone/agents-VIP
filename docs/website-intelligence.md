# Website Intelligence v1

Website Intelligence runs automatically inside Agent 2 enrichment. It is a
versioned, evidence-backed diagnostic of the prospect's public website and is
kept separate from the deterministic Agent 3 Marketing Opportunity Score during
the initial calibration phase.

## Audit defaults

- Audit version: `website-intelligence-v1`
- Maximum sampled pages: 15 (`WEBSITE_AUDIT_MAX_PAGES`)
- Audit cache: 30 days (`WEBSITE_AUDIT_CACHE_DAYS`)
- Per-page fetch timeout: 8 seconds (`WEBSITE_AUDIT_FETCH_TIMEOUT_MS`)
- PageSpeed Insights: optional (`GOOGLE_PAGESPEED_API_KEY`)

The crawler prioritizes the homepage, service pages, contact/booking pages,
about/team pages, location pages, and blog/news/resource pages. Individual page
failures do not fail Agent 2 enrichment.

## Site-level measurements

Website Intelligence stores a separate Website Health score and component
scores for:

- Content freshness
- Site structure / information architecture
- Conversion architecture
- Technical SEO
- Performance / Core Web Vitals when PageSpeed is configured
- Mobile experience
- Automated accessibility signals
- Structured data
- Platform health
- Trust / credibility
- AI discoverability
- Basic site/browser hygiene

These are diagnostic website-quality measurements, not the Agent 3 Marketing
Opportunity Score. A low Website Health score can represent a strong marketing
opportunity when the company is otherwise a good business fit.

## Page-level measurements

Each sampled page can store:

- URL and page type
- HTTP status
- Title and meta description
- Canonical URL
- H1 and heading structure
- Word count
- Public publication/modification date signals
- Estimated content age and stale-content signal
- Internal link count
- Image and missing-alt counts
- Form and CTA signals
- Mobile viewport signal
- Detected JSON-LD schema types
- CMS/platform signatures
- Page content/conversion/technical-SEO diagnostic scores
- Evidence

## Platform/version detection

Website Intelligence records only publicly observable platform evidence. It can
detect signatures for systems such as WordPress, Wix, Squarespace, Shopify,
Webflow, HubSpot CMS, and some front-end libraries/frameworks.

A version is stored only when it is directly observable in public markup/assets.
`versionCurrencyVerified` remains false unless version currency has been
independently verified. The system must not claim that a CMS, theme, or plugin
is outdated merely because the current version is not externally observable.

## Accessibility

Accessibility results are automated diagnostics only. They are not a legal ADA
compliance determination and do not establish complete WCAG conformance.

## PageSpeed

If `GOOGLE_PAGESPEED_API_KEY` is configured, the audit requests both mobile and
desktop PageSpeed/Lighthouse data and stores available lab/field measurements.
If the key is absent or PageSpeed fails, Agent 2 continues and records the
performance section as unavailable.

## Security guardrails

The crawler:

- permits only HTTP/HTTPS targets;
- rejects localhost/private/internal/link-local targets;
- validates redirect destinations;
- applies response-size limits;
- applies request timeouts;
- treats the feature as public website measurement, not vulnerability scanning.

## Storage

Run migration:

```text
supabase/migrations/010_add_website_intelligence.sql
```

It creates:

- `website_audits`
- `website_audit_pages`

and adds Website Intelligence summary fields to `prospects`.

The full page evidence lives in the audit tables. Agent 2 and qualification job
payloads carry only the compact site-level audit summary so 100-record jobs do
not duplicate all page records.

## Downstream behavior

Agent 2 appends a human-readable Website Intelligence summary and a
non-scoring `type: unknown` marketing observation. Agent 3 currently scores only
`type: opportunity` marketing signals, so Website Intelligence does not change
the v1 score formula yet.

The audit summary remains available downstream for evidence-based Agent 5
personalization. After a representative calibration batch, the Website
Intelligence dimensions can be deliberately incorporated into a future scoring
version rather than silently changing `marketing-opportunity-v1`.
