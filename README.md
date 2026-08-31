# VIP Prospect Intelligence

Node.js B2B prospect discovery service for Web Search Professionals and
Marketing VIP.

## Universal Prospect Discovery

Agent 1 now uses one discovery engine with industry-specific playbooks.

Initial verticals:

- Dental
- Construction & Trades
- Legal Services
- Machine Shops & Light Manufacturing

Each playbook defines the business types, capabilities, specialties, and
research signals that matter for that vertical.

The discovery workflow is intentionally evidence-first:

1. A web-research agent searches public business information.
2. A formatter converts the research dossier into plain JSON.
3. Node.js parses and validates the JSON locally with Zod.
4. Duplicate websites are removed.
5. Results are shown in the UI and upserted into Supabase.

Discovery confidence is not a final sales opportunity score.

## Public UI

The root URL serves the multi-industry Prospect Intelligence interface.

The UI dynamically loads its industry filters from:

```
GET /api/industries
```

Public searches use:

```
POST /api/public/discovery
```

Example request:

```json
{
  "industry": "construction",
  "market": "Milwaukee, WI",
  "radiusMiles": 25,
  "maxResults": 5,
  "priorities": ["roofing", "hvac", "remodeling"],
  "companyTypes": ["independent", "small_group"]
}
```

Public requests are limited to 10 results, a 100-mile radius, and an in-memory
per-IP hourly rate limit. Set `PUBLIC_SEARCHES_PER_HOUR` to override the
default of 20.

## Private API

Authenticated integrations can use:

```
POST /api/agents/discovery
Authorization: Bearer <AGENT_API_TOKEN>
```

The previous dental endpoints remain available as compatibility aliases:

```
POST /api/public/dental-discovery
POST /api/agents/dental-discovery
```

## Supabase

Run both migrations in order:

```
supabase/migrations/001_create_prospects.sql
supabase/migrations/002_generalize_prospects.sql
```

Migration 002 adds:

- `subindustry`
- `company_type`
- `company_type_confidence`
- `capabilities`

It also backfills existing dental records from the original dental-era fields.

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
- `PUBLIC_SEARCHES_PER_HOUR`

## Health

```
GET /health
```

The health endpoint reports Node, OpenAI, Supabase, public/private discovery
availability, and the enabled industries.
