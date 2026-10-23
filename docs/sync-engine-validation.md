# Sync integration verification

Date: 2026-10-18. Requirements: [SE01-SE14](requirements/sync-engine.md).
Decision: [ADR-0003](adr/0003-vinext-deployment-bootstrap.md).

This ledger describes the current sync migration. The previous
[PDF viewer deployment record](pdf-viewer-validation.md) predates these changes
and does not establish that the new sync integration is deployed or validated.

## Evidence ledger

| Check | Status | Evidence or limitation |
| --- | --- | --- |
| Local package inspection | Complete | Reviewed the local Vinext package, core 2.2.0 APIs, requirements and ADR-0008. Legacy 1.1.1 protocol/storage incompatibility is explicit. Package version numbers alone do not identify the locally revised implementation. |
| Application table adapter | Passed | Nine tests cover complete 520-row hydration, changed-field patches, fresh reads, serial writes, revision races, stopped-account guards, storage/enqueue failure and 130 paginated authority resolutions. Real-browser testing caught and corrected the separate resolution-page limit (64 by default). |
| App TypeScript | Passed | `npm run typecheck` passes against the generated schema, revised client/provider and Cloudflare runtime binding types. Repeat if subsequent integration changes affect these paths. |
| Generated ownership/drift check | Passed | `npm run sync:check` reports every generated/create-once file unchanged. |
| Production build and deployment ID | Passed locally | `npm run build` and `wrangler deploy --dry-run --config dist/server/wrangler.json` pass. The output includes `CF_VERSION_METADATA` and the session route prefers its version ID in production. A real remote redeployment is still unobserved. |
| Built Worker runtime | Passed locally | Cloudflare Vite preview serves the compiled Worker. HTML, signup with opaque cookie, authenticated session with a production deployment ID, an authorized empty D1 snapshot, logout and token revocation pass through the built routes. `npm start` uses this preview runtime. |
| Full app unit suite | Passed | `npm test`: 29 tests, including six opaque-session and stream/origin authorization cases, nine adapter cases and the existing 14 viewer geometry/export tests. |
| Viewer browser regression suite | Passed | `npm run test:browser`: 27 passes, one intentional desktop touch skip. These fixtures use a local row-store stub. |
| Package snapshot/rollover checks | Passed | Final sibling `npm run check`: 598 tests plus strict core/browser/worker/consumer type checks. Covers a racing D1 commit, atomic install failure, malformed snapshots, IndexedDB recovery, redirect rejection, version changes, lease draining, pending/accepted work across account switches, and settled versus pending old-schema recovery. Retained-store integrity failures do not create replacement empty state. |
| Real authenticated app authority | Passed locally | `npm run test:sync`: actual React provider, opaque sessions, native browser IndexedDB/Web Locks and local D1. Covers populated snapshot at nonzero watermark, same-version identity, new-version identity, failed-download retention, pending-work barrier/recovery, cross-account denial, retired APIs and logout revocation. A queued edit also survives logout and a blocked second-account login; returning to its original account resumes the same client identity, drains the edit, then permits the isolated second account. Deployment IDs are injected into the real session response; no Worker is published. |
| Clean SQL / retained accounts | Passed | Both new migrations execute on empty SQLite; reapplying auth/session SQL preserves an existing account's password hash. Default migration scripts run only the new idempotent SQL, avoiding the historical seed-account UPSERT. |
| Dependency audit | Existing follow-up | npm reports 19 advisories (13 high, five moderate, one low), no critical. Cloudflare tooling retains Miniflare `sharp`/`undici` advisories; existing KaTeX 0.16.47 has a conditional low-severity advisory. The existing Vinext `fflate` image-generation chain has no app call site and is absent from the inspected production bundle. No broad dependency remediation is claimed by this migration. |
| Fresh remote deployment | Not performed | This change does not by itself apply remote migrations or publish a Worker. Record an actual deployment and its live checks separately if performed. |
| Physical mobile gestures | Pending | These remain viewer acceptance checks; the sync migration does not establish device gesture quality. |

Update this ledger only with observed checks, commands and material limitations.
Do not count stubbed UI fixtures as authenticated cross-client sync evidence.

## Reproducible local checks

From the application root:

```sh
npm run typecheck
npx sync-engine-vinext generate --check
npm test
npm run build
npm run test:browser
npm run db:local:migrate
npm run test:sync
```

Use the application-owned SQL workflow to apply the reviewed
`migrations/0001_sync_pdf_annotation.sql` and
`migrations/0003_auth_sessions.sql` to the selected local D1 database before
testing real authentication or sync. Generation never applies those files.
The initial sync migration is create-once; do not rewrite it for a later
schema change. Legacy migrations and rows are not new-store adoption inputs.
The auth migration creates `users` if absent and preserves existing accounts.
Do not rerun the historical initial SQL: it includes a seed-account UPSERT.
Development defaults to local bindings. `SYNC_REMOTE_BINDINGS=true` is an
explicit opt-in for remote development; the integration test always forces local.

The obsolete `/sw.sync.js` now activates only to unregister its own legacy
registration. It does not read, migrate or delete old browser databases.

Verified with Node 24.14.0, Chrome 155.0.8059.80, Vite 8.3.4, Vinext 1.2.1 and
Wrangler 4.113.0 on Windows. Package SHA-256 hashes:

| Local artifact | SHA-256 |
| --- | --- |
| `vendor/mintcd-sync-engine-2.2.0.tgz` | `b01e0a6881d5364876fe0c48f4ee7d6fb91983fa33b318fa6464099035398cd9` |
| `vendor/mintcd-sync-engine-vinext-1.0.0.tgz` | `540321746c3567e47c3bca6422b7b77f2e29348ea905e701eca88dc3231cd57c` |

When changing local package code, rebuild/package its core and Vinext outputs,
replace the corresponding `vendor/` tarballs and reinstall so the lockfile and
installed code agree. Check the installed artifacts, rather than assuming a
package with an unchanged version contains the latest local revision.

## Deployment-bootstrap acceptance procedure

1. Use a local D1 fixture with two accounts. Apply the reviewed migrations,
   authenticate account A through the app and verify the response sets an
   opaque session cookie. The database must contain its hash rather than its
   plaintext token. Forged/expired cookies and the old header/cookie must fail.
2. Start deployment A with a unique Worker version ID (or local fallback
   override). Bootstrap the browser, create a document
   and highlight, and synchronize. Confirm the account-scoped materialized D1
   rows and canonical watermark. Reload the same build and confirm the client
   identity and local data are reused.
3. Update D1 through an authorized second client, then create deployment B with a
   different Worker version ID. Reopen the first browser. Confirm its newly
   enabled replica
   contains the current D1 snapshot and continues with deltas after the returned
   watermark. Confirm D1 rows/history were not reset by the deployment change.
4. Interrupt the snapshot download or fail candidate-store writes. Confirm the
   existing replica is retained and incomplete state never appears ready. Retry
   with working connectivity/storage and confirm a complete replacement.
5. In deployment A, make offline changes that leave pending work. Open deployment
   B. Confirm rollover reports its barrier and retains A's data and identity.
   Drain A through its working authorized authority, retry B and confirm current
   D1 data plus subsequent deltas. Do not discard queued work to make the test
   pass.
6. Include more than 250 documents/annotations to exercise snapshot and local
   query pages. Apply an authorized write during hydration and confirm the
   published tables contain one consistent revision with no omitted page.
7. Sign out while work is active. Confirm local revocation/draining finishes
   before the server token is revoked, stale callbacks cannot republish A's
   rows and the old cookie fails. Sign in as B and confirm exact-stream
   authorization and isolated local rows. Same-account sign-in receives a fresh
   runtime config while retaining valid same-deployment state.
8. Roll back to a different deployment ID and repeat the snapshot/barrier
   checks. Verify ordinary reloads of that rollback do not repeatedly reset the
   browser replica. Verify all retired legacy writer routes return HTTP 410.

The current snapshot limit is 10,000 total rows and 8 MiB of JSON, with a
30-second browser request deadline. Exercise an above-limit failure separately
from ordinary paginated local reads and confirm that the prior replica remains
retained.

For each observed run, record build IDs, package tarball hashes, browser/runtime
versions, local versus remote D1, and whether any queue or snapshot fault was
injected. A successful initial empty-store bootstrap does not prove rollover
from a populated prior deployment.
