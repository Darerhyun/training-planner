# Luna Implementation Rules

## 1. Scope discipline

- Read `AGENTS.md`, `docs/00-INDEX.md`, and the domain document named by the spec before editing, because repository decisions override assumptions.
- Implement every listed requirement and only those requirements, because each PR must remain independently reviewable.
- Touch only files explicitly named or clearly required by the spec. If another file is necessary, escalate before editing it.
- Do not refactor, rename, reformat, optimize, reorganize, or clean up unrelated code, even nearby code.
- Preserve existing filters, pagination, Sync behavior, session-span semantics, API fields, and tests unless the spec explicitly changes them.
- Preserve unrelated user changes and stop if they overlap your task.

## 2. Bug handling

- Self-fix only an obvious mechanical defect inside an in-scope file that blocks the requested implementation: a typo, missing/wrong import, syntax error, or directly caused TypeScript error.
- Put `// FIX: <brief reason>` immediately beside every self-fix, because no deviation may be silent.
- Do not self-fix unrelated failing tests, behavior bugs, data problems, schema discrepancies, or design weaknesses.
- List every self-fix under `Fixes Applied`; write `None.` when there were none.
- Escalate schema mismatches, architectural conflicts, contradictory or ambiguous requirements, unsafe migrations, auth/security implications, or required out-of-scope changes. Stop rather than invent a resolution.

## 3. Escalation protocol

Use exactly:

`ESCALATE: <short title> — Fact: <observed fact>. Conflict: <why the spec cannot be followed safely>. Decision needed: <one precise question>.`

Do not continue past the affected step. You may complete independent, already-authorized work only when it cannot prejudice the decision. Repeat the same line under `Escalations`; write `None.` if there are none.

## 4. Repository conventions

- Use Node 22 ESM TypeScript. Keep two-space indentation, semicolons, single quotes, trailing commas, and `.js` suffixes in relative imports.
- Place shared auth/database/types in `services/shared/src`; API routes in `services/core-api/src/routes`; ingestion logic in `services/core-api/src/ingest`; web code in `apps/web/src`; schema in `db/schema.sql`; migrations in `db/migrations`; documentation in `docs`.
- Use kebab-case filenames, camelCase functions/variables, PascalCase React components and exported types, and snake_case database columns/row fields. Preserve an endpoint's existing JSON casing; do not normalize old contracts opportunistically.
- API responses are endpoint-specific Hono JSON objects. Collections use named keys and errors use `{ error: string }`, optionally with established fields such as `code` and `currentVersion`.

  Correct: `return c.json({ sessions: rows });`

  Incorrect: `return c.json({ success: true, data: rows });`

- Write raw PostgreSQL through `getDb()`/injected `SqlQuery`; the query returns a row array. Always parameterize values with `$1`, `$2`, etc. Use `withTransaction` for atomic multi-query writes.

  Correct: `await db<Row>('SELECT id FROM sessions WHERE id = $1', [id]);`

  Incorrect: ``await db(`SELECT id FROM sessions WHERE id = '${id}'`);``

- Protect routes with `authMiddleware()` followed by `requireRole(...)`. Active read roles are normally `admin`, `ops`, `finance`, `viewer`; write roles must match the spec, commonly `admin`, `ops`. Never rely on frontend visibility for authorization.
- For testable routes, follow the existing factory pattern (`createXRoutes(options = {})`) with injectable database/auth/transaction dependencies, then export the default route instance.
- Model schema unions with string-literal types, database nullability with `| null`, untrusted input as `unknown`, and row results with explicit types/generics. Use `import type`; do not use `any`.
- Keep API client types and calls in `apps/web/src/api.ts`; use generic `apiFetch<T>`. Components are PascalCase; helpers are camelCase.
- Co-locate `*.test.ts` files. Use `node:test`, `node:assert/strict`, fake injected dependencies, and assertions for status, body, SQL/parameters, authorization, and regressions.

## 5. Hard prohibitions

- Never modify Firebase configuration, authentication logic, admin allowlists, or auth middleware.
- Never change the `programmes` schema or programme ownership semantics; escalate first.
- Never commit secrets, credentials, real trainer fees, tokens, production data, or populated `.env` files.
- Never add a dependency unless the spec requires it. If required, list package, version, changed manifest/lockfile, and reason in `Summary`.
- Never apply migrations, change production data, deploy, commit, or push unless the spec explicitly instructs it.
- Never add Firestore, Vertex AI, Cloudflare, inferred training dates, or fee exposure contrary to `AGENTS.md`.

## 6. Required final response

Return these sections in order:

1. `Implementation` — requirements completed, files changed, and validation commands/results.
2. `Summary` — concise behavior and contract changes, including any dependency.
3. `Fixes Applied` — each `// FIX:` item, or `None.`
4. `Escalations` — each exact `ESCALATE:` line, or `None.`

Never claim a check passed unless you ran it.

## 7. Self-check before finishing

- Every spec item is implemented and tested.
- Only authorized files and behavior changed.
- API, SQL, auth, naming, types, and folder conventions match existing code.
- Every self-fix has a `// FIX:` comment and summary entry.
- No silent deviation, secret, forbidden change, or unreported dependency exists.
- Typecheck, tests, build, and `git diff --check` were run when requested.
