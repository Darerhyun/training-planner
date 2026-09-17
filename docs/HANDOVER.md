# OpenAI workflow handover

> Verified read-only on 17 September 2026 UTC. This document closes the
> Sol/Luna/Astra/Sol High workflow. Claude assumes planning, implementation,
> review, and release coordination after this handover is merged.

## 1. Repository release gate

| Item | Verified state |
|---|---|
| Repository | `Darerhyun/training-planner` (public) |
| `main` at handover branch creation | `a993470122b1b96f2e1795ebf0648af9eacecefa` |
| `main` tree | `c44fc16ac87c996d9114f5217ea0b9652230749c` |
| Latest `main` check | Build Health #153, run `34913034162`, successful |
| Handover branch | `docs/openai-handover`, created from the exact `main` above |
| Handover head | Recorded by the draft PR and final merge evidence; a commit cannot contain its own SHA |

`infra/baselines.json` was re-read at the handover base. Its
`sourceBaseline.sha` is `6007159630f567f9d4e0fa3deee4922354243ec9`
(verified 14 September by Sol), and its `deployedBaseline.sha` is
`645ea70b816a82fae3482dd862d8602c92035106` (deployed 9 September; last
verified evidence by Sol High for PR #29). The file expressly describes the
deployed baseline as evidence rather than a live guarantee. The source
baseline is an ancestor of this handover branch.

### Branch protection discrepancy

The live GitHub configuration does **not** enforce the intended policy. The
branch endpoint reports `protected: false`, the protection endpoint returns
`404 Branch not protected`, repository rulesets are empty, and no required
status check is configured. The operating documents call for pull requests,
successful `Build Health`, and blocked force-pushes, but those are procedural
rules only until an owner configures them in GitHub. The successor should
resolve this discrepancy before relying on GitHub to enforce the gates.

### Repository-level Actions variables

These are non-secret configuration values. `FIREBASE_API_KEY` is the public
Firebase web-client key, not a private credential.

| Variable | Current value |
|---|---|
| `FIREBASE_API_KEY` | `AIzaSyDnpsYy8fjiwaWoMr0FPV9hxcbvG5_Lhdk` |
| `FIREBASE_AUTH_DOMAIN` | `ask-training-planner-2026.firebaseapp.com` |
| `FIREBASE_HOSTING_ORIGIN` | `https://ask-training-planner-2026.web.app` |
| `GCP_ADMIN_EMAILS_SECRET` | `training-planner-admin-emails` |
| `GCP_ARTIFACT_REPOSITORY` | `training-planner` |
| `GCP_DATABASE_SECRET` | `training-planner-database-url` |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | `training-planner-deployer@ask-training-planner-2026.iam.gserviceaccount.com` |
| `GCP_PROJECT_ID` | `ask-training-planner-2026` |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | `training-planner-runtime@ask-training-planner-2026.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/54648572815/locations/global/workloadIdentityPools/github-actions/providers/training-planner` |
| `GCS_UPLOAD_BUCKET` | `ask-training-planner-2026-uploads` |

## 2. In-flight work and repository refs

### Open pull request

PR #34, **feat(sync): add re-check and row resolution**, is the only
pre-existing open PR.

| Field | State |
|---|---|
| PR state | Open and draft |
| Base | `a993470122b1b96f2e1795ebf0648af9eacecefa` |
| Head | `f7d19d7fd78b607a710447347e8b65dbe995dcef` |
| Tree | `43b96c305d49c7d74a4466df3bec2f569136832f` |
| Scope | 12 files |
| Build Health | #154, run `34921543637`, passed |
| Sol High | Approved |
| Remaining gate | Claude parallel high-risk and UI/IX review, then owner acceptance and exact merge authorization |
| Not authorized | Ready state, merge, migration, production query/change, mapping seed, session repair, deployment, REFERENCE-DATA-1B, or PR3K |

Open issue #4, **Environment gate**, remains open and appears stale relative to
the recovered production environment. The successor must triage it rather
than treating it as current evidence.

### Remote branches verified before creating this handover branch

`contained` means the tip is already reachable from the handover base;
`diverged` means it contains commits outside the current `main` history. Only
`feat/sync-resolution-1` is active work. The others are historical remnants;
do not delete them without a fresh owner-approved review.

| Branch | Exact head | State |
|---|---|---|
| `agent/add-sol-luna-rules-admin-roadmap` | `7cda4311aa7312ab665025937f9dbd2823a30661` | contained |
| `agent/atomic-cloud-run-public-access` | `98ec7f159356f4a80af03f68c48e364d53ee786b` | diverged |
| `agent/infra-recovery-deployment-readiness` | `bef203df842e4aa70d1e8b7bbb58ce81ceb6a946` | diverged |
| `agent/infra-recovery-neon-guardrails` | `6ada31838a7748a36dc747f4657fc1963999a3f1` | contained |
| `agent/one-day-upload-retention` | `cbe5978189a8952e3ed869d494a7c06c18880b08` | diverged |
| `agent/private-free-deployment-guardrails` | `b4bb9e26d60edd330734c69c5495b46879d358b6` | diverged |
| `agent/recovery-secret-v2-public-preflight` | `9c4392fe2da3aa0861aae464ca2f5c302381d421` | diverged |
| `agent/trainer-rate-reconciliation-docs` | `7ddb32e1fd4d5e7f935de905cbdf48bde1bcac49` | diverged |
| `chore/database-secret-v3-pin` | `81442a6ebd965e619551ead8e951d7d03b217808` | diverged |
| `chore/deploy-exact-revision-traffic` | `ec531874bb84509e8341684c25a62a2f1c824ed9` | diverged |
| `docs/harness-astra-xhigh` | `0e283a0007f582761bfafc9ce375e4a5754513e6` | contained |
| `docs/harness-truth-and-review-gates` | `9015abe5cde0d852cbaa7f90a9fab5153be32119` | contained |
| `docs/pr3j-design-inputs-v8` | `b2ab59c91e140b21d4b17618ed6608fabe559fe5` | contained |
| `docs/pr3k-rate-reconciliation-design` | `5161738443d3cad2426a7b43ac00f44806bd0d51` | contained |
| `docs/sync-reference-repair-contract` | `d445b8ee733e8ab565051cdf132b5ec0c45600b6` | contained |
| `feat/pr3j-trainer-directory` | `2379a203ca2baf28ac1af1e93dfadaa434efcba5` | contained |
| `feat/reference-data-1a` | `e6b1fd934aa7ddacc1a446cdca1bb5ceab680293` | contained |
| `feat/sync-resolution-1` | `f7d19d7fd78b607a710447347e8b65dbe995dcef` | active PR #34 |
| `feat/sync-safe-1` | `f32742b8a37e15c4656d5cd07a1ad48664525b70` | contained |
| `feature/ask-ux-visual-foundation` | `1e3ad21538a1a9103828c400775890c40641852a` | diverged |
| `feature/pr3g-sessions-ux` | `47af05aaf989ecfb2595287829e1cefe6f3b8f5d` | diverged |
| `feature/pr3h-course-planning` | `c2d6e9f0b9c001b107115b4ce3c7f90d62c396fc` | diverged |
| `feature/pr3i-admin-user-access` | `01026fed5254f116d56841f3e91fe59fe1b3e265` | contained |
| `feature/r2-strict-http-errors` | `ed0c0a73bd2f7f340eb8066199bc7db266a0361c` | contained |
| `feature/r8-schedule-import-safety` | `23c4f48bc6e1e301ce2deea83e0104415deaa13e` | contained |
| `luna/docs-truth-backlog` | `a486741f7f986fdba4699ffb474c90c4e4c4bae8` | contained |
| `luna/fix-core-api-test-glob-quote` | `685b9122e17351fc0d16042dd6176023a43fd81f` | contained |
| `luna/governance-sol-high-review` | `69bb533e6d44022c3dad54cab9fec9a0e1588664` | contained |
| `luna/pr3gv-attention-api-prerequisite` | `f6ca4a60c1f35ee25c63885052adedf19147df3e` | contained |
| `luna/pr3gv-v4-sessions-ui` | `360f5bc0da53bfd50a18811a0c067d3472b3055b` | contained |
| `luna/r1-shared-http-error` | `446ac288e73d0b6a40ff2ed630f5e812c50f32ec` | contained |
| `luna/r5-first-signin-cleanup` | `a873442bf5e52b7ee51572279f2f19eee852c1bb` | contained |
| `luna/r12-split-web-app` | `a7d7db8102c343e4e2ab45642e15d3f7167ee6d2` | contained |

The only unfinished implementation work order is SYNC-RESOLUTION-1 in PR
#34. REFERENCE-DATA-1B, SESSION-REPAIR-1, cleanup, and PR3K are planned but
not started. No other escalation is open except the protection discrepancy,
the sensitive owner handoff below, and the production least-privilege item.

## 3. Google Cloud

| Item | Verified state |
|---|---|
| Project | `ask-training-planner-2026` |
| Region | `asia-southeast1` |
| Cloud Run service | `core-api` |
| Revision receiving 100% traffic | `core-api-run-34308349512-1` |
| Revision commit | `645ea70b816a82fae3482dd862d8602c92035106` |
| Image digest | `sha256:f9a0626290e20d2f280682606e6dbc5a200215556332fdfd8a21b460da8de34d` |
| Artifact Registry repository | `training-planner`; `core-api` cleanup after 30 days |
| Upload bucket | `ask-training-planner-2026-uploads`, `ASIA-SOUTHEAST1`, uniform bucket-level access |
| Bucket lifecycle | Delete live objects at age one day |
| Bucket CORS | `PUT` only from `https://ask-training-planner-2026.web.app`; `Content-Type`; max age 3600 |
| Deployer service account | `training-planner-deployer@ask-training-planner-2026.iam.gserviceaccount.com` |
| Runtime service account | `training-planner-runtime@ask-training-planner-2026.iam.gserviceaccount.com` |
| Workload Identity | pool `github-actions`, provider `training-planner`; issuer `https://token.actions.githubusercontent.com` |
| Provider condition | repository ID `1260059760`, owner ID `178456601`, ref `refs/heads/main` |

Secret Manager contains `training-planner-database-url` (versions 3 and 2
enabled, version 1 disabled; deployment pins version 3) and
`training-planner-admin-emails` (version 2 enabled, version 1 disabled;
deployment pins version 2). These are names and numeric versions only; no
secret value is recorded here.

Observed IAM bindings are:

- deployer: project roles `roles/firebasehosting.admin` and
  `roles/serviceusage.apiKeysViewer`;
- deployer: `roles/artifactregistry.writer` on the Artifact Registry
  repository and `roles/run.developer` on the Cloud Run service;
- deployer: `roles/iam.serviceAccountUser` on the runtime service account and
  `roles/iam.workloadIdentityUser` for the numeric GitHub repository
  principal set;
- runtime: self `roles/iam.serviceAccountTokenCreator`, bucket
  `roles/storage.objectCreator` and `roles/storage.objectViewer`, and
  `roles/secretmanager.secretAccessor` on both named secrets; and
- `allUsers`: `roles/run.invoker` on the public Cloud Run service.

## 4. Neon and Firebase owner-private transfer

Owen will transfer sensitive provider details directly to the successor.
They must not be inferred from repository prose or added to GitHub.

Read-only verification established only that the database is `neondb`, the
server is PostgreSQL 17.11 (`server_version_num` `170011`), and the pooled URL
in Secret Manager database version 3 authenticates as `neondb_owner`. No
connection string is retained. Owen will privately transfer the Neon project
name, branch, region, direct role, compute range, and autosuspend setting. The
successor must reverify all of them. The pooled runtime currently using an
owner role is a least-privilege follow-up, not authority to rotate or change
production.

Firebase project and Hosting site are `ask-training-planner-2026`, with the
default site at `https://ask-training-planner-2026.web.app`. Owen will
privately transfer the enabled Auth-provider details. `ADMIN_EMAILS` lives
only in Secret Manager secret `training-planner-admin-emails`, pinned to
version 2; no address list is recorded here.

## 5. Deployment procedure

Dispatch `.github/workflows/deploy-recovery.yml` from `main` as actor
`Darerhyun` on `refs/heads/main`. Supply all four exact inputs:

| Input | Required value |
|---|---|
| `confirmation` | `DEPLOY TRAINING PLANNER` |
| `target_project_id` | the exact `GCP_PROJECT_ID` value |
| `expected_commit_sha` | the exact current `github.sha` on `main` |
| `cost_acknowledgement` | `I ACKNOWLEDGE LOW-COST LIMITS` |

The last successful recovery deployment is run `34308349512` (#8), for
commit `645ea70b816a82fae3482dd862d8602c92035106`. It activated
`core-api-run-34308349512-1`; the recorded rollback target is
`core-api-run-34192959611-1`.

## 6. Production data and staged repair

Aggregate-only read-only evidence shows one applied batch since 9 September,
created `2026-09-09T07:22:03Z`. It created 242 import-managed sessions dated
from 1 October 2026 through 29 January 2027. Of those sessions, 26 have Hotel
pending, one has an unmatched non-Hotel venue, none has a blank venue, and 51
have no room. There are no `session_change_history` rows; all 242 sessions have
`management_source = import`; none was updated after creation; and their most
recent update equals the upload time.

Eight sessions use six FT/NFT codes: `FT-DDM1`, `FT-GENAI2`, `FT-IIO1`,
`NFT-DDM1`, `NFT-GENAI2`, and `NFT-IIO1`. Their business meaning remains an
inventory decision; do not assume they are safe to ignore or delete.

No existing-session repair or placeholder cleanup has occurred. The deployed
commit predates merged REFERENCE-DATA-1A and open SYNC-RESOLUTION-1, so neither
new capability is deployed or migrated. Continue `sync-reference-repair.md`
§10 in this order:

1. finish PR #34's Claude review, owner acceptance, exact merge authorization,
   and successful post-merge Build Health;
2. obtain separate approvals for required migrations and deployment;
3. implement and review REFERENCE-DATA-1B;
4. approve a read-only production inventory, including the six FT/NFT codes;
5. implement SESSION-REPAIR-1 with explicit selection, version checks,
   preserved evidence, and all-or-nothing apply;
6. produce and approve the cleanup dry run and ordered cleanup; and
7. resume PR3K only after the preventive and corrective Sync work is accepted.

Production must never be queried, migrated, repaired, seeded, or deployed on
the strength of this document alone.

## 7. Successor safeguards

- Hotel is a known venue-pending state, not an import blocker or a physical
  venue assignment. It remains visible in Needs attention and in HOTEL
  planning without invented capacity or conflict conclusions.
- Blank trainer, venue, or owned-venue room is an operational warning and
  imports unassigned; a non-empty unmatched supplied value blocks apply.
- A per-batch skip requires a reason and retains source presence so it cannot
  accidentally cancel an existing session. No permanent-ignore rule or
  cancellation-threshold override has been approved.
- PR3K remains paused. No production rate-category mapping or economics change
  is authorized by the product documents alone.
- Every future mutation or provider action needs fresh live verification and
  the appropriate owner authorization.

## 8. Retention and closeout

No private credential, secret payload, database connection string, access
token, service-account key, personal Admin email list, trainer identity,
trainer fee, workbook, or row-level production data is retained by Sol, Luna,
Astra, or Sol High. The Firebase web API key shown above is an explicitly
non-secret client configuration variable. Temporary authenticated sessions
and working copies are not a credential handoff; Owen must transfer sensitive
provider facts directly and the successor must reverify them.

After this document's PR is merged and the resulting `main` Build Health is
green, the OpenAI-side coordination role is closed.
