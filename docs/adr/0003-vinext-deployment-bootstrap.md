# ADR-0003: Use Vinext sync with a D1 snapshot after each deployment

Status: Accepted

Date: 2026-10-18

Requirements: [SE01-SE14](../requirements/sync-engine.md).
Evidence: [sync verification](../sync-engine-validation.md).

This decision updates the synchronization/storage boundary described in
[ADR-0002](0002-portable-annotations.md). The viewer and portable annotation
coordinate decisions remain applicable.

## Context

The app used core 1.1.1's generated `/next` routes, a React table client and a
single IndexedDB replica-record format. The local sync-engine repository now
provides core 2.2.0 and a dedicated Vinext 1.0.0 package with declarative CRUD,
generated hooks, D1 authority composition and shared browser session lifecycle.
Its protocol and storage layout are incompatible with the legacy integration.

The user chose a fresh initial sync store and then specified that the browser
must rebootstrap from D1 after **every deployment**. Keeping IndexedDB across
deployments without checking a release identity would not satisfy that request.
Deleting all browser storage on startup would lose offline work and would also
reset ordinary reloads within the same deployment.

The legacy session identified a user with an unsigned user-ID cookie or an
override header. The new authority requires a trusted account, exact stream
authorization and a shared authentication boundary for snapshots and deltas.

## Decision

### 1. Integrate the locally maintained packages through their public surface

Track the local core and Vinext build artifacts as tarballs under `vendor/` and
install them through explicit `file:` dependencies and the lockfile. Their
version numbers are core 2.2.0 and Vinext 1.0.0; local source revisions may include
changes that are absent from registry artifacts with those version numbers.

Author one `sync-engine.config.ts`. Put the generation plugin before `vinext()`.
Generation emits `sync/generated.ts`, exporting the typed `useSyncEngine`, and
the `/api/sync` route, exporting the model/schema types. Application code owns
`sync/server.ts` authentication/policy hooks and the reviewed SQL migrations.
Generate/check/build does not apply SQL to D1.

The React provider creates a stable runtime config only after a successful
authenticated session response and passes `null` while signed out. Runtime
`createSyncConfig` and the generated hook supply schema inference and package
lifecycle management. The provider retains the existing UI table interface via
an application-owned adapter over asynchronous collection APIs.

### 2. Keep initial fresh adoption separate from ongoing deployment recovery

Use a new sync-managed D1 namespace. Retain legacy tables and IndexedDB data
without importing them into the new store. Retire the old sync and CRUD writer
routes with HTTP 410. No legacy snapshot, canonical history or outbox conversion
is claimed.

After the initial transition, D1 remains the durable authority across all
deployments. A new deployment replaces browser replica state with a snapshot
of the authenticated stream's current materialized D1 rows. It does not clear
D1 or reseed the authority from a potentially stale browser snapshot.

### 3. Bind replica bootstrap to a deployment ID and canonical watermark

Bind [Cloudflare version metadata](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/)
as `CF_VERSION_METADATA`. The authenticated
`/api/auth/session` response supplies `deploymentVersion` from that binding's
actual Worker version ID. The provider validates this value and prefers it to
the build fallback. Republishing the same artifact still creates a new Worker
version ID, so it cannot accidentally skip deployment recovery. A session
refresh that observes a new version rotates the runtime config even when the
account has not changed.

For local environments without Worker version metadata, Vite embeds
`__SYNC_DEPLOYMENT_VERSION__` from `SYNC_DEPLOYMENT_VERSION` when provided;
otherwise each production build gets a random UUID. Development uses the stable
value `development`. Distinct local deployment simulations must use distinct
overrides when testing rollover.

The runtime config passes this value as `deploymentVersion`. The package
registry records which deployment initialized the replica. An equal value
resumes it. A different value requests the authenticated D1 snapshot, validates
its stream/contract and canonical watermark, builds a complete replacement and
only then enables it. Ordinary deltas continue after the watermark so writes
that followed snapshot creation are not skipped.

Do not encode deployment identity in `appId`, `contractVersion` or schema version.
These remain stable logical/storage contracts. A rollback to a different Worker
version reboots its browser replica under the same rules. Production identity
therefore follows the deployed Worker rather than a reusable build artifact.

### 4. Make pending work a rollover barrier

Before replacing any retained replica, check its durable pending and
accepted-awaiting queues. This also applies to a disabled replica belonging to
another account. If either has work, fail with an actionable message
and retain its registry mapping, database and identity. Never silently discard
queued edits or
replay whole browser rows over the latest authority state.

The recovery procedure is to sign into the previous account and drain that work
under the prior deployment, then retry the new deployment. If that is impossible,
recover/export or discard work
only through a separately explicit decision. Snapshot download/storage failures
also preserve the previous store until a complete replacement can be enabled.

The first launch of a new deployment therefore needs a valid session and network
access. Already-open clients can keep editing offline. Reloading this app still
resolves the session through the server; offline cold starts are not guaranteed.
Same-deployment replica recovery reuses its local state. No new PWA installation
or background scheduling guarantee is introduced.
The current bounded snapshot allows 10,000 total rows and 8 MiB of encoded JSON;
the browser also sets a 30-second request deadline. Exceeding those bounds fails
without publishing a partial replacement. Paginated or streamed network snapshot
transfer would require a separate protocol change.

### 5. Authenticate with revocable opaque sessions

Login/signup issue a random opaque cookie token. D1 stores only its hash,
account binding and expiration in `auth_sessions`; signout revokes it. The
server resolves the token independently of browser-provided account IDs and
does not accept the old user-ID header/cookie as authentication.

The application-owned server hook applies the same account/session, exact-stream
and same-origin authorization checks to snapshots and delta requests. Local
signout first awaits package `logoutSync()` to disable and drain active replica
leases, then clears/revokes the server session. Account changes similarly revoke
the old local session before changing configurations.

### 6. Preserve UI behavior with explicit asynchronous data boundaries

The table adapter reads fresh rows before deciding insert versus update and
only submits changed non-primary-key fields. It serializes writes, refreshes
the local arrays before awaited writes resolve, pages through complete
collections and retries hydration when the replica revision changes between
pages. Stopped accounts cannot publish delayed results or continue queued writes.

`get()` is asynchronous. Undo/redo waits for those fresh reads before comparing
historical expectations. Cached `all()` arrays are presentation state, not a
replacement authority. Full-row `put()` cannot infer application intent for
every stale caller; it is not a conditional-write protocol or a cross-client
transaction. Core field-patch policy determines canonical merge order.

Opening, transport/storage errors, durable queue counts and authority rejection
notices are mapped to the existing persistence UI. Durable local enqueue does
not imply remote acceptance.

## Consequences

The application follows the local package's generated, typed API and avoids
duplicating replica lease and IndexedDB lifecycle management. Each new
deployment starts from D1's account-scoped materialization while same-deployment
reloads retain local identity and offline work.

The initial migration intentionally leaves legacy data outside the new store.
Old clients stop writing through retired endpoints and existing users must sign
in to obtain an opaque session. A new deployment needs network access for its first
bootstrap; queued old-deployment edits can block it until resolved. Rollback and
CI release identifiers are now part of the browser recovery contract.

Local tarballs make this app's package inputs reproducible, but each subsequent
sync-engine revision requires rebuilding/repacking the corresponding artifacts,
updating the lockfile and repeating relevant app checks. Physical-device and
authenticated deployment results remain separate evidence from unit tests or
viewer fixtures.
