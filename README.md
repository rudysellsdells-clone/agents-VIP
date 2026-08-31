# VIP Prospecting Agents

Node.js agent service for B2B prospect discovery and qualification.

## Agent 1: Dental Prospect Discovery

The first agent discovers independent and small-group dental practices in a
requested market using public web information. It records evidence, relevant
services, and discovery confidence, then upserts candidates into Supabase with
status `DISCOVERED`.

It does **not** collect patient information, personal contact information, or
make the final sales-opportunity score.

### Required environment variables

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (recommended) or legacy
  `SUPABASE_SERVICE_ROLE_KEY`
- `AGENT_API_TOKEN`
- `NODE_ENV=production`

Optional:

- `DISCOVERY_MODEL` (defaults to `gpt-5.4-mini`)

Generate a strong API token on the server with:

```bash
openssl rand -hex 32
```

Store the result only in the cPanel app environment as `AGENT_API_TOKEN`.

### Database setup

Run the SQL in:

```
supabase/migrations/001_create_prospects.sql
```

against the `agents-VIP` Supabase project before expecting persistence to
succeed.

### Trigger Agent 1

```bash
curl -X POST "https://agents-4.websearchpros.ai/api/agents/dental-discovery" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "market": "Milwaukee, WI",
    "radiusMiles": 50,
    "maxResults": 10
  }'
```

The endpoint accepts:

- `market`: required city/region string
- `radiusMiles`: 1-250, default 50
- `maxResults`: 1-25, default 15

### Health

```
GET /health
```

Health reports Node, Supabase, OpenAI, and whether the protected dental
discovery endpoint is configured.\n
## Public user interface

The root URL serves a responsive dental prospect finder. The browser calls:

```
POST /api/public/dental-discovery
```

The public route never receives server secrets. It currently enforces:

- Maximum 10 prospects per search.
- Maximum 100-mile radius.
- In-memory per-IP hourly search limiting.
- Server-side input validation.

Set `PUBLIC_SEARCHES_PER_HOUR` to change the default public limit of 3 searches
per hour. The in-memory limiter is intentionally simple for V1; move it to a
durable store before high-volume public promotion.

The existing bearer-token endpoint remains available for internal automation:

```
POST /api/agents/dental-discovery
```
