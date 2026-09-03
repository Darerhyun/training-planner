# Training Schedule Planner

Internal planning tool for ASK Training's operations team. The app ingests the
master training schedule Excel file, turns it into structured sessions, and
helps planners review course, trainer, room, and viability information before
updates are reflected in the company's official training management system.

## Recovery stack

- Neon PostgreSQL in Singapore, using pooled TLS connections at runtime
- A tightly limited Cloud Run API using Node 22, TypeScript, and Hono
- A Vite SPA on Firebase Hosting
- Firebase Auth for email magic-link sign-in and role-based access
- Temporary Google Cloud Storage signed uploads with one-day retention

## Repository and deployment evidence

The repository `main` source baseline for this documentation change is
`130b1e61b2822d572f29f677ad4a9f2a786d98ce`, verified read-only before the branch
was created. The deployed application baseline is
`749908290131882505efb011300d446ee9926c74`, recorded as last-verified evidence.
These are intentionally distinct: repository `main` may contain changes that
are not present in the deployed application baseline.

Provider, production, and deployment facts are evidence records rather than
current-state guarantees unless independently reverified. This documentation
change performs no provider read or mutation and does not provision, configure,
dispatch, or deploy any resource.

## Project map

- Agent/project ground rules: [AGENTS.md](AGENTS.md)
- Delivery harness: [WORKFLOW_HARNESS.md](WORKFLOW_HARNESS.md)
- Domain knowledge index: [docs/00-INDEX.md](docs/00-INDEX.md)
- Local setup and recovery plan: [docs/SETUP.md](docs/SETUP.md)
- Audit maintenance backlog: [docs/01-product/maintenance-backlog.md](docs/01-product/maintenance-backlog.md)
- Machine-checked cost controls: [infra/cost-guardrails.json](infra/cost-guardrails.json)

This repo is a planning aid, not the regulated system of record. Sensitive
trainer rate values belong only in the protected production PostgreSQL database
and are never committed to source control.
