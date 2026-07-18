# Training Schedule Planner

Internal planning tool for ASK Training's operations team. The app ingests the master training schedule Excel file, turns it into structured sessions, and helps planners review course, trainer, room, and viability information before updates are reflected in the company's system of record.

## Stack

- Google Cloud SQL for Postgres as the shared database
- Cloud Run API using Node 22, TypeScript, and Hono
- Vite SPA hosted on Firebase Hosting
- Firebase Auth for email magic-link sign-in and role-based access
- Google Cloud Storage signed uploads for schedule Excel files

## Project Map

- Agent/project ground rules: [AGENTS.md](AGENTS.md)
- Domain knowledge index: [docs/00-INDEX.md](docs/00-INDEX.md)
- Local setup and deployment notes: [docs/SETUP.md](docs/SETUP.md)

This repo is the planning aid, not the official training management system. Sensitive trainer rate values are kept in Google Cloud SQL and are not committed to source control.