# Training Planner Delivery Workflow Harness

## 1. Purpose

This harness is mandatory for every change to application code, infrastructure,
database schema, GitHub state, or deployment. It separates planning,
implementation, review, acceptance, and release so no agent silently expands
scope or approves its own work.

Documentation-only work follows the same role boundaries whenever its work order
invokes this harness.

## 2. Roles

- **Sol** owns architecture, product decisions, bounded work orders, and
  acceptance.
- **Luna** owns implementation, tests, the implementation branch and pull
  request, and any expressly authorised merge or deployment.
- **Terra** independently reviews the actual diff and evidence. Terra is
  read-only and never fixes, commits, pushes, merges, or deploys.
- **The user** remains the product decision-maker and must expressly approve any
  material scope, security, data, infrastructure, cost, or deployment decision.

## 3. Required delivery sequence

1. Sol inspects the relevant repository state and issues a bounded work order
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
5. Luna implements only the approved work, runs the approved validation, and
   reports every deviation. Before an unplanned file or behaviour change, Luna
   sends a **LUNA CHANGE NOTICE** and returns to Sol for a revised decision.
6. Luna submits a **LUNA IMPLEMENTATION REPORT** with changed files, validation
   evidence, fixes, escalations, resulting commit SHA, and pull-request link.
7. Terra independently inspects the work order, Luna report, actual diff, and
   validation evidence. Terra returns either approval or changes required with
   evidence.
8. Changes required return to Sol. Sol issues a bounded correction order; Luna
   repeats the pre-edit notice and approval gate before editing.
9. Sol records implementation acceptance only after Terra approves. Acceptance
   does not by itself authorise merge or deployment.
10. Luna alone may merge or deploy, and only when the work order expressly
    authorises the action, Terra has approved, and Sol has separately recorded
    acceptance and merge/deployment authorisation.
11. Before deployment, Luna sends a **LUNA DEPLOYMENT PLAN** with target, exact
    commit, configuration or migration impact, validation, rollback, and cost
    impact. After deployment, Luna sends a **LUNA DEPLOYMENT REPORT**.
12. Terra performs read-only post-deployment verification against the accepted
    commit and deployment criteria.

## 4. Mandatory gates

- A changed base, branch head, PR state, or mergeability result stops the
  affected step.
- Any architectural, authorization, data-safety, cost, schema, migration, or
  scope conflict returns to Sol.
- No role may infer approval from silence or from an earlier, differently scoped
  work order.
- No direct push to main.
- No merge or deployment while Terra review or Sol acceptance is outstanding.
- No deployment solely because implementation was accepted.
- Production changes require an explicit target, rollback, and post-deployment
  verification plan.

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

Production and provider facts are last-verified evidence only unless Terra or
another authorized reviewer independently rechecks them read-only. This
documentation work performs no provider read or mutation and does not authorize
another deployment, rollback, infrastructure, or provider change. Every future
release remains subject to the review, acceptance, express authorization,
rollback, cost, and post-deployment gates above.
