# VIP Prospect Intelligence

Node.js B2B prospect discovery and enrichment service for Web Search
Professionals and Marketing VIP.

## Agent 1: Universal Prospect Discovery

Agent 1 uses one discovery engine with industry-specific playbooks.

Initial verticals:

- Dental
- Construction & Trades
- Legal Services
- Machine Shops & Light Manufacturing

Each playbook defines the business types, capabilities, specialties, and
research signals that matter for that vertical.

The discovery workflow is evidence-first:

1. A web-research agent searches public business information.
2. A formatter converts the research dossier into plain JSON.
3. Node.js parses and validates the JSON locally with Zod.
4. Duplicate websites are removed.
5. Results are shown in the UI and upserted into Supabase.

When a business publicly publishes a contact email, discovery stores that exact
address. The agent must not infer or construct email addresses from names,
domains, or patterns.

Discovery confidence is not a final sales opportunity score.

## Agent 2: Prospect Enrichment

Agent 2 enriches one already-discovered company at a time.

It researches:

- Business summary, specialties, service area, and company-size signals.
- Verified services/capabilities.
- Public professional decision-makers and leadership.
- Verified public business contact paths.
- Growth and investment signals.
- Website/UX, SEO/content, conversion, positioning, reputation, social,
  paid-visibility, AI-discovery, and competitive marketing observations.
- An evidence-based opportunity summary.
- Enrichment confidence.

Agent 2 does **not** calculate the final Marketing Opportunity Score. That is
reserved for Agent 3.

Decision-maker information must be relevant public professional information.
Private contact information and sensitive personal information are prohibited.
Email addresses may be stored only when explicitly published for business
contact; guessed or pattern-generated addresses are prohibited.

## Public UI

The root URL serves the multi-industry Prospect Intelligence interface.

Industry configuration:

```
GET /api/industries
```

Discovery:

```
POST /api/public/discovery
```

Agent 2 enrichment:

```
POST /api/public/enrichment
```

Each discovery result card includes an **Enrich Prospect** action. Agent 2
results open inline beneath the prospect.

Public research calls share the in-memory per-IP rate limit. Set
`PUBLIC_SEARCHES_PER_HOUR` to override the default of 20.

## Private API

Authenticated integrations can use:

```
POST /api/agents/discovery
POST /api/agents/enrichment
Authorization: Bearer <AGENT_API_TOKEN>
```

The previous dental discovery endpoints remain available as compatibility
aliases:

```
POST /api/public/dental-discovery
POST /api/agents/dental-discovery
```

## Supabase

Run migrations in order:

```
supabase/migrations/001_create_prospects.sql
supabase/migrations/002_generalize_prospects.sql
supabase/migrations/003_add_business_email.sql
supabase/migrations/004_add_prospect_enrichment.sql
```

Migration 004 is defensive and also creates the email column/index if migration
003 has not yet been applied.

Agent 2 adds:

- `business_summary`
- `service_area`
- `company_size_signals`
- `decision_makers`
- `contact_paths`
- `growth_signals`
- `marketing_signals`
- `opportunity_summary`
- `enrichment_confidence`
- `enrichment_agent`
- `enriched_at`

Enrichment updates the same prospect record by the existing
`(industry, website)` unique key and sets status to `ENRICHED`.

## Required environment variables

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY`
- `AGENT_API_TOKEN`
- `NODE_ENV=production`

Optional:

- `DISCOVERY_MODEL`
- `DISCOVERY_RESEARCH_MODEL`
- `DISCOVERY_FORMAT_MODEL`
- `ENRICHMENT_RESEARCH_MODEL`
- `ENRICHMENT_FORMAT_MODEL`
- `PUBLIC_SEARCHES_PER_HOUR`

## Health

```
GET /health
```

The health endpoint reports Node, OpenAI, Supabase, discovery/enrichment
availability, and enabled industries.


## Agent 3: Deterministic Marketing Opportunity Scoring

Agent 3 makes no OpenAI or web-research call. It consumes the structured
evidence already produced by Agents 1 and 2 and applies a fixed scoring formula.

Score categories:

| Category | Maximum |
| --- | ---: |
| ICP Fit | 20 |
| Marketing Opportunity | 20 |
| High-Value Services | 15 |
| Growth Signals | 15 |
| Competitive Opportunity | 10 |
| Digital Weakness | 10 |
| Decision-Maker Access | 10 |
| **Total** | **100** |

The score is deterministic and versioned as `marketing-opportunity-v1`.
Identical normalized inputs produce the same category scores and total.

Tiers:

- `PRIORITY`: 80-100
- `STRONG`: 65-79.9
- `DEVELOP`: 50-64.9
- `LOW`: below 50

Public endpoint:

```
POST /api/public/scoring
```

Private endpoint:

```
POST /api/agents/scoring
Authorization: Bearer <AGENT_API_TOKEN>
```

The UI exposes **Calculate Opportunity Score** after Agent 2 enrichment.

Run migration 005:

```
supabase/migrations/005_add_opportunity_scoring.sql
```

Agent 3 stores:

- `marketing_opportunity_score`
- `score_tier`
- `score_breakdown`
- `score_version`
- `score_next_action`
- `scored_at`

A scored prospect is moved to status `SCORED`.
