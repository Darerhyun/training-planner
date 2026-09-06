# Training Planner Delivery Workflow Harness

## 1. Purpose

This harness is mandatory for every change to application code, infrastructure,
database schema, GitHub state, or deployment. It separates planning,
implementation, review, acceptance, and release so no agent silently expands
scope or approves its own work.

Documentation-only work follows the same role boundaries whenever its work order
invokes this harness.

## 2. Roles

- **Sol** owns coordination, architecture, scope, sequencing, bounded work orders,
  acceptance, and release gates; Owen retains product decision authority.
- **Luna Max** owns context-heavy/high-volume delivery: consumes the approved work
  package, decomposes bounded execution packages, delegates difficult implementation
  and high-confidence execution to Astra Low, then integrates and validates.
- **Astra Low** is implementation/execution only within Luna's bounded package,
  pre-authorized by that approved package. No scope expansion, review, release
  decision, merge, or deploy. Higher Astra reasoning requires Owen's explicit
  permission after a stated blocker/reason. See `LUNA_RULES.md`.
- **Sol High** is the independent read-only code/technical reviewer after
  implementation; it cannot implement the same work item. See `SOL_HIGH_RULES.md`.
- **Claude** is UI/IX authority and read-only conformance reviewer for UI changes;
  recommendations pass Sol's architecture gate. Not required for non-UI work
  unless Owen requests it.
- **Terra** is retired from the active workflow; historical audit facts stand.
- **Owen (the user)** remains the product decision-maker and must expressly approve any
  material scope, security, data, infrastructure, cost, or deployment decision.

## 3. Required delivery sequence

1. Sol checks capabilities and the authorized publish path before lengthy work,
   then inspects relevant repository state and issues a bounded work order
   with an expected base SHA, allowed scope, acceptance criteria, validation,
   exclusions, rollback, and stop conditions.
2. Luna performs read-only inspection of the expected branch, head, base,
   relevant documents, and changed-file state.
3. Before any edit, Luna sends a **LUNA PRE-EDIT NOTICE** containing:
   - work order;
   - base SHA and expected/current head;
   - branch;
   - exact files expected to change;
   - database/schema impact;
   - infrastructure/cost impact;
   - tests and validation;
   - deployment target;
   - rollback method;
   - deviations or questions.
4. Luna waits. No edit is permitted until Sol returns **APPROVED_TO_EDIT** for
   the inspected state and bounded scope.
5. Luna decomposes the approved package and delegates bounded difficult execution
   to Astra Low, integrates the implementation, runs approved validation, and
   reports every deviation. Before an unplanned file or behaviour change, Luna
   sends a **LUNA CHANGE NOTICE** and returns to Sol for a revised decision.
6. Luna submits a **LUNA IMPLEMENTATION REPORT** with changed files, validation
   evidence, fixes, escalations, resulting commit SHA, and pull-request link.
7. Sol High independently inspects the work order, Luna report, actual diff,
   and validation evidence without editing or having implemented this work item.
   For UI work, Claude also reviews UI/IX conformance against the same exact head;
   recommendations pass Sol's architecture gate. Reviewers return approval or
   changes required with evidence.
8. Changes required return to Sol. Sol issues a bounded correction order; Luna
   repeats the pre-edit notice and approval gate before editing.
9. Sol records implementation acceptance only after Sol High approves and any
   required Claude review approves. Acceptance
   does not by itself authorise merge or deployment.
10. Only Owen authorizes merge or deployment. An explicitly authorized executor
    outside the Astra/reviewer roles may perform it only after the required
    reviews and Sol's separately recorded acceptance and release-gate clearance.
11. Before deployment, the authorized executor sends a **DEPLOYMENT PLAN** with target, exact
    commit, configuration or migration impact, validation, rollback, and cost
    impact. After deployment, the executor sends a **DEPLOYMENT REPORT**.
12. Sol High performs read-only post-deployment verification against the accepted
    commit and deployment criteria.

## 4. Mandatory gates

- A changed base, branch head, PR state, or mergeability result stops the
  affected step.
- Any architectural, authorization, data-safety, cost, schema, migration, or
  scope conflict returns to Sol.
- No role may infer approval from silence or from an earlier, differently scoped
  work order.
- No direct push to main.
- No merge or deployment while required review, Sol acceptance, or Owen's
  explicit authorization is outstanding.
- No deployment solely because implementation was accepted.
- Production changes require an explicit target, rollback, and post-deployment
  verification plan.
- At a capability or publication blocker, send a concise checkpoint with the
  observed limitation, completed work, preserved evidence, and decision needed;
  do not silently retry or bypass permissions.
- Preserve the patch, tree, and local validation evidence until the remote branch
  SHA/tree and PR base/head/diff are verified. Local-only success is not publication.

## 5. Escalation format

Use exactly:

> ESCALATE: short title — Fact: observed fact. Conflict: why the work order
> cannot be followed safely. Decision needed: one precise question.

Do not continue past the affected step until Sol resolves the escalation and,
when product authority is needed, the user approves the decision.

## 6. Repository and deployment evidence

The repository `main` source baseline for the current documentation work is
`130b1e61b2822d572f29f677ad4a9f2a786d98ce`, verified read-only before branching.
The deployed application baseline is
`749908290131882505efb011300d446ee9926c74`, recorded as last-verified evidence.
These baselines are intentionally distinct; repository `main` may contain
changes that are not present in the deployed application.

Production and provider facts are last-verified evidence only unless Sol High or
another authorized reviewer independently rechecks them read-only. This
documentation work performs no provider read or mutation and does not authorize
another deployment, rollback, infrastructure, or provider change. Every future
release remains subject to the review, acceptance, express authorization,
rollback, cost, and post-deployment gates above.
