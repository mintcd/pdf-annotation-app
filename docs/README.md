# Documentation

The PDF reader and synchronization changes follow the requirements and decisions
below. The reader uses PDF.js for mobile zooming, panning and portable annotation
geometry. The sync integration uses the locally maintained Vinext package and
bootstraps each new deployment's browser replica from authoritative D1 data.

The initial sync transition intentionally starts with a fresh store, as selected
by the user; it does not adopt legacy rows or queued edits. Subsequent deployments
retain D1 and refresh browser state through the snapshot/watermark protocol.
Pending work blocks replacement until safely resolved. See the separate
[sync verification ledger](sync-engine-validation.md) for current evidence;
the earlier [PDF viewer results](pdf-viewer-validation.md) describe the previous
viewer release and do not prove the new sync integration is deployed.

Read in this order:

1. [PDF viewer requirements](requirements/pdf-viewer.md): behavior and observable
   acceptance criteria.
2. [Sync integration requirements](requirements/sync-engine.md): generated
   collections, authentication, deployment bootstrap and pending-work protection.
3. [Architecture](architecture.md): viewer, application, data and build
   responsibilities.
4. Architecture decision records:
   - [ADR-0001: Use the PDF.js complete viewer](adr/0001-pdfjs-viewer.md).
   - [ADR-0002: Preserve portable annotation positions and application-owned sync](adr/0002-portable-annotations.md).
   - [ADR-0003: Use Vinext sync with a D1 snapshot after each deployment](adr/0003-vinext-deployment-bootstrap.md).
5. Verification: [sync integration](sync-engine-validation.md) and
   [PDF viewer/mobile acceptance](pdf-viewer-validation.md).

Requirements describe **what must hold**. The architecture describes **how the
parts fit**. ADRs preserve **why a consequential choice was made**, including
alternatives and tradeoffs. Verification distinguishes an implemented path from
an observed result.

The user accepted the PDF.js and sync changes on 2026-10-18. ADR-0003 supersedes
the old storage-preservation boundary for the separately authorized fresh sync
transition. Accepted decision status does not imply every acceptance check has
passed. Add a new numbered ADR to
supersede a consequential accepted decision; update the current requirements and
architecture when the behavior changes.
