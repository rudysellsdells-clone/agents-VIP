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
supabase/migrations/005_add_opportunity_scoring.sql
supabase/migrations/006_reconcile_prospect_persistence.sql
supabase/migrations/007_add_contact_resolution.sql
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


## Persistence diagnostics and repair

Release 0.6.1 hardens Supabase persistence for both supported server credential
types:

- New `sb_secret_...` keys are sent on the `apikey` header only.
- Legacy `service_role` JWT keys are sent on both `apikey` and
  `Authorization: Bearer ...` so they can bypass RLS as intended.

The `/health` endpoint now checks the actual `prospects` table and validates
that all columns required by Agents 1-5 are available.

If migrations were applied out of order, run the idempotent repair migration:

```
supabase/migrations/006_reconcile_prospect_persistence.sql
```

This migration reconciles the Agent 1-5 schema, indexes, constraints, RLS
enablement, and backend `service_role` table grants.


## Agent 4: Deep Contact Resolution

Agent 4 runs only after Agent 2 enrichment and Agent 3 scoring. By default, a
prospect must score at least 65 before contact resolution is allowed. Override
that gate with `CONTACT_RESOLUTION_MIN_SCORE`.

Agent 4 performs a new public-business research pass focused specifically on:

- Verifying the strongest relevant decision-maker.
- Ranking up to five secondary decision-makers.
- Verifying public business email, business phone, contact forms, company
  LinkedIn, and public professional profile routes.
- Preferring role relevance and verified contactability over title alone.
- Producing an evidence-based outreach angle and recommended channel for Agent 5.

Agent 4 does not write outreach copy and does not send messages. It does not
infer email addresses, phone numbers, or private contact information.

Public endpoint:

```
POST /api/public/contact-resolution
```

Private endpoint:

```
POST /api/agents/contact-resolution
Authorization: Bearer <AGENT_API_TOKEN>
```

The UI exposes **Resolve Decision Maker** only when the Agent 3 score meets the
configured threshold.

Run migration 007:

```
supabase/migrations/007_add_contact_resolution.sql
```

Agent 4 stores:

- `primary_decision_maker`
- `secondary_decision_makers`
- `resolved_contact_paths`
- `outreach_angle`
- `contact_resolution_summary`
- `contact_resolution_confidence`
- `contact_resolution_score`
- `contact_resolution_agent`
- `contact_resolved_at`

A successfully persisted contact resolution moves the prospect status to
`CONTACT_RESOLVED`.

Optional Agent 4 environment settings:

- `CONTACT_RESEARCH_MODEL`
- `CONTACT_FORMAT_MODEL`
- `CONTACT_RESOLUTION_MIN_SCORE`

The default threshold is 65.


## Agent 5: Personalized Outreach Composer

Agent 5 runs after Agent 4 contact resolution. It does not perform web research
and it does not send messages. It composes a reusable draft package entirely
from the verified context produced by Agents 1-4.

The package includes:

- Primary email subject and body.
- Respectful follow-up email.
- Concise LinkedIn message.
- Permission-based call opener.
- Website contact-form message.
- Personalization summary.
- Evidence used in the drafts.
- Claims the outreach should avoid.
- Preferred channel carried forward from Agent 4.
- Draft-generation confidence.

Agent 5 is specifically instructed not to mention internal scoring,
enrichment, monitoring, or research to the prospect, and not to invent private
business problems or unsupported claims.

Public endpoint:

```
POST /api/public/outreach
```

Private endpoint:

```
POST /api/agents/outreach
Authorization: Bearer <AGENT_API_TOKEN>
```

The UI exposes **Create Outreach Drafts** after Agent 4 completes. Each draft
can be copied individually. There is intentionally no send button in Agent 5.

Run migration 008:

```
supabase/migrations/008_add_outreach_drafts.sql
```

Agent 5 stores:

- `outreach_package`
- `outreach_preferred_channel`
- `outreach_generation_confidence`
- `outreach_agent`
- `outreach_generated_at`

A successfully persisted draft package moves the prospect status to
`OUTREACH_DRAFTED`.

Optional Agent 5 environment setting:

- `OUTREACH_MODEL`

Sending, CRM creation, or automated sequence enrollment is intentionally
reserved for a later approval/publishing stage.


### Persuasion framework selection

Agent 5 now selects an explicit persuasion framework from the verified research
rather than relying on generic personalization.

Supported frameworks include:

- FOMO
- Loss aversion
- Opportunity cost
- Social proof
- Specificity
- Contrast
- Authority
- Reciprocity

The selected framework is stored inside the outreach package with:

- Primary framework.
- Optional secondary framework.
- Why the framework fits this prospect.
- Evidence basis from Agents 1-4.
- An application rule describing how the concept should shape the drafts.

FOMO is never treated as a default. It may be used only when the supplied
research supports a genuine timing, competitive, growth, or missed-opportunity
argument. Agent 5 is instructed never to invent scarcity, deadlines, competitor
activity, customer behavior, or urgency.

For many B2B prospects, specificity plus opportunity cost may be more credible
than overt urgency.

### Qualification job cap

The upcoming automated Agents 2-4 qualification pipeline is capped at 100
records per job for the current phase.

`QUALIFICATION_JOB_MAX_RECORDS=100`

The application itself enforces an upper ceiling of 100 even if a larger
environment value is supplied. This limit can be revisited after real usage,
cost, retry, and quality telemetry has been collected.
