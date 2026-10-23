# Sync-engine integration requirements

Status: Accepted. Date: 2026-10-18.

Decision: [ADR-0003](../adr/0003-vinext-deployment-bootstrap.md).
Implementation evidence: [sync verification](../sync-engine-validation.md).

## Scope

Replace the legacy `@mintcd/sync-engine` 1.1.1 integration with the locally
maintained core 2.2.0 and `@mintcd/sync-engine-vinext` 1.0.0 packages. Keep the
PDF reader, document keys, annotation position format, notes and color settings
connected to the new generated collection client.

The user explicitly selected a fresh initial sync store. This transition does
not import legacy D1 rows, canonical history, browser outboxes or IndexedDB
snapshots. Legacy tables and local databases are retained; they are not the new
store. This supersedes the storage-preservation boundary of the earlier viewer
migration for this separately authorized sync transition.

After that initial transition, **every production deployment must rebootstrap
the browser from current account-scoped D1 data**. A deployment changes the
browser replica; it must never reset the authority database. Normal refreshes
within the same deployment resume the current replica and its queued edits.

## Implementation requirements

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| SE01 | Use the local Vinext integration contract. | Exact local core 2.2.0 and Vinext 1.0.0 tarballs are tracked under `vendor/` and resolved by the lockfile. Runtime imports use the new public exports. The app does not depend on an unpublished change being present in a registry artifact with the same version. |
| SE02 | Generate from one logical schema. | `sync-engine.config.ts` declares document, annotation and color fields, primary keys, indexes, stable app/contract IDs, endpoint and D1 binding. Generation owns `sync/generated.ts`, the sync route and its ownership manifest. Application authentication/policy hooks and the initial migration are create-once authored files. Generation/check makes no remote database changes. |
| SE03 | Bootstrap from authoritative D1 after every deployment. | The authenticated session endpoint returns the actual Cloudflare Worker version ID from `CF_VERSION_METADATA.id`. First use of that deployment obtains its D1 materialized snapshot at a canonical watermark, then continues synchronization from that watermark. Redeploying the same built artifact still receives a different Worker version ID. No D1 truncation, sequence reset or bulk rewrite is part of this flow. |
| SE04 | Resume safely within one deployment. | Reloading or reopening the same deployment keeps the replica's identity, watermark, pending edits and account isolation. Recovery opens existing storage rather than silently resetting missing state to sequence one. Development uses a stable `development` ID unless explicitly overridden. |
| SE05 | Replace local state only after a complete snapshot. | Snapshot authentication, account/stream/contract/schema identity, rows, checksum and watermark are checked before the replacement replica becomes enabled. A partial download or storage failure does not replace a working replica. Canonical changes after the snapshot watermark arrive through ordinary deltas. |
| SE06 | Protect work during deployment and account changes. | If any retained replica has pending proposals or accepted work awaiting confirmation, replacement stops with an actionable error and retains its data and registry mapping. This includes a disabled replica from another account. Sign into the previous account/deployment and drain its work before retrying, or make an explicit separate discard/recovery decision. |
| SE07 | Authenticate both snapshot and delta requests. | The server resolves an opaque session token through its stored hash, checks expiration and establishes the account independently of client configuration. Anonymous, missing, expired, forged, mismatched-stream and disallowed-origin requests are rejected before opening authority storage. The legacy user-ID cookie and `x-pdf-annotation-user-id` header cannot authorize a request. |
| SE08 | Revoke local sessions before identity changes. | Signout awaits `logoutSync()` before clearing the server cookie. Account/stream switching awaits revocation and draining before opening the replacement configuration. A delayed load/write for the previous engine cannot publish rows to the new account. A new authenticated configuration is created after reauthentication. |
| SE09 | Keep all mutations on the engine boundary. | Application table helpers use fresh asynchronous engine reads and enqueue collection inserts, changed-field updates or deletes. Primary keys and unchanged fields are excluded from update patches. A resolved mutation means durable local enqueue; canonical rejection remains visible and is never presented as confirmed synchronization. |
| SE10 | Hydrate complete, consistent local collections. | UI tables load bounded pages until their cursors finish, rather than stopping at the default first 50 rows. Collections and pages must share a replica revision; intervening writes cause a retry. Readiness stays false until the complete snapshot is published. Awaited mutations refresh the materialized arrays before resolving. |
| SE11 | Report actual persistence state. | UI compatibility properties map opening/ready/error and engine sync phases, pending proposals and accepted-awaiting counts. Storage, transport, bootstrap-barrier and authority rejection errors remain observable. Incoming rows update overlays and sidebars without creating duplicate local mutations. |
| SE12 | Keep legacy APIs from acting as competing writers. | Old `/api/sync/pull`, `/api/sync/push`, `/api/documents`, `/api/annotations` and `/api/operations` handlers return HTTP 410. The obsolete `/sw.sync.js` unregisters its own registration when updated. They cannot mutate either authority. Auth and unrelated GitHub/PDF routes remain separately scoped. |
| SE13 | Keep release and infrastructure operations explicit. | Production uses the actual Worker version ID supplied by the server, including redeployment and rollback. Local environments without version metadata fall back to `__SYNC_DEPLOYMENT_VERSION__`: a production build UUID or explicit `SYNC_DEPLOYMENT_VERSION`, and stable `development` during dev. Generated SQL and the auth-session migration are reviewed and applied separately from source generation. |
| SE14 | Record the limits of evidence. | Package tests, app unit tests, typecheck, production build, browser fixtures, real local authority checks and any remote deployment are recorded separately. A stubbed viewer browser test does not establish real authentication, snapshot bootstrap or cross-client sync correctness. |

## Data and lifecycle boundaries

Annotation positions remain version-1 JSON serialized as a string in the logical
schema. New D1 collection tables use the engine's stream/key/data representation;
they are not aliases for the old `documents`, `annotations` and `highlight_colors`
tables. Stable app and contract IDs describe the data model. The deployment ID is
a separate runtime lifecycle value and does not change those schema identities.

A raw D1 genesis seed at sequence zero is not a client-deliverable import.
Deployment recovery uses the explicit snapshot/watermark protocol. Existing-data
adoption, history migration, browser outbox translation and automatic schema
evolution remain outside this change.

Offline editing after a completed bootstrap continues within the same
deployment. The first bootstrap of a new deployment needs the authenticated
server. Browser storage eviction and a deployment barrier require an explicit
recovery path; the UI must surface those conditions rather than promise that
rendered local rows are already safe in D1.

The current package exports one bounded snapshot response: at most 10,000 total
collection rows and 8 MiB of encoded JSON. The browser enforces its 8 MiB budget
and a 30-second request deadline. These are explicit limits, not a promise of
unbounded or streamed bootstrap. Above-limit failures retain the prior replica;
larger installations need a separately designed snapshot protocol.
