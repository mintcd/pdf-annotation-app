# PDF viewer requirements

Status: Accepted. Date: 2026-10-18.

Delivery and verification are tracked in the
[verification guide](../pdf-viewer-validation.md). Architectural decisions are
[ADR-0001](../adr/0001-pdfjs-viewer.md) and
[ADR-0002](../adr/0002-portable-annotations.md).

## Purpose and scope

Replace EmbedPDF with the PDF.js complete viewer to improve zooming and panning
on mobile. Reuse upstream viewer interactions and page rendering. Keep the
application's toolbar, annotations, comments, document library and synchronization
contracts integrated with the reader.

This is a viewer migration. It does not migrate the sync-engine package or the
application database. Reading a local file does not imply that its bytes are
uploaded or available on another device. Remote source identity continues to
refer to the normalized URL; local source identity continues to use the file
content hash.

## Reading and interaction requirements

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| PV01 | Open both supported source types. | A local file opens from its bytes; a remote URL opens through the existing `/api/pdf` proxy. Reopening either source resolves the same document key and annotations as before the migration. |
| PV02 | Use the PDF.js viewer interaction layer. | Page layout, text/link layers, rendering scheduling and zoom behavior come from PDF.js. The app does not substitute canvas-only rendering or an independent pinch recognizer. |
| PV03 | Support touch pinch zoom inside the reader. | On physical iOS Safari and Android Chrome, pinching over the PDF changes document scale around the gesture without unintentionally scaling the application chrome. Several zoom-in/zoom-out cycles leave the document readable and navigable. |
| PV04 | Support touch panning and continuous reading. | At fit width, a one-finger swipe scrolls through successive pages. Above fit width, the user can reach both horizontal page edges and continue vertically; panning does not create highlights or activate links accidentally. |
| PV05 | Keep explicit zoom controls usable. | Zoom in/out updates the displayed scale, and fit width fits the current reader area. Opening/closing a panel, rotating the device and toggling chrome do not leave an inaccessible page or stale scale display. |
| PV06 | Preserve document navigation. | Page entry is bounded to the document; embedded internal links and table-of-contents destinations navigate correctly. Back/forward restores recorded jump locations. External links retain safe browser link behavior. |
| PV07 | Preserve editable document outlines. | A nested outline is displayed and its destinations can be followed. Users can add, edit and delete outline entries; the downloaded PDF includes those changes. Absent or failed outlines have an explicit state. |
| PV08 | Preserve native text selection. | A desktop drag and a mobile long press select PDF text through its text layer. Selecting across lines/pages yields page-specific geometry; scrolling and pinch gestures do not create a selection action inadvertently. |

## Annotation and persistence requirements

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| PA01 | Create highlights from selected text. | Choosing a configured color creates page-specific highlight rows with selected text, stable IDs, document identity, timestamps and version-1 position data. The selection action reports a failed write instead of claiming success. |
| PA02 | Keep existing position data compatible. | Existing `version: 1`, `kind: "pdf-highlight"` positions render at the same location. Stored rectangles use zero-based page indexes and unrotated, top-left page coordinates; zoom/rotation/CSS pixels are not stored. Invalid positions do not crash the viewer or silently rewrite saved rows. |
| PA03 | Align highlights with their text. | Existing and new highlights remain aligned after zoom, scroll and page rotation, including pages with an offset crop box. Selecting a sidebar item or an initial annotation link reveals the corresponding page and annotation. |
| PA04 | Preserve annotation editing. | A user can change color, edit a note and delete a highlight. The page overlay, annotation sidebar and count reflect the resulting local rows. A failed mutation remains visible to the user. |
| PA05 | Keep sync-engine as the persistence boundary. | Annotation and document mutations use the existing table client and session/stream identity. Incoming row changes update the viewer without duplicate local writes; unmounting or zooming creates no data mutations. |
| PA06 | Describe persistence truthfully. | Loading, queued, syncing, synced and error states continue to reflect the application's persistence/sync status. A rendered overlay or completed download alone is never treated as remote synchronization confirmation. |
| PA07 | Preserve document identity across the migration. | The normalized-URL/content-hash document key, database schema, annotation row IDs, comments and configured highlight colors remain usable without an automatic data reset or database migration. |
| PA08 | Export the visible application annotations. | Download produces a readable PDF containing the current saved highlight colors and notes as PDF annotations while retaining the original document content. Reopening an exported file does not duplicate app rows simply because embedded annotations exist. Export failures are reported. |

## Integration and lifecycle requirements

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| PI01 | Ship a coherent local PDF.js release. | Display API, viewer code, worker, CSS and required rendering resources come from a pinned compatible release and load from the application origin. Production build output contains those assets and preserved upstream notices; no runtime CDN is required. |
| PI02 | Release viewer-owned resources. | Changing source or unmounting cancels/discards obsolete document work, destroys the loading task/document, removes subscriptions and releases owned object URLs. A delayed callback from document A cannot change document B. |
| PI03 | Keep server rendering independent of browser APIs. | Importing/rendering the app on the server does not instantiate a PDF viewer or access `window`, `document`, canvas or a browser worker. The viewer starts in the browser and presents loading/error states. |
| PI04 | Bound page rendering to the reader viewport. | A multipage fixture can be read and zoomed without the app eagerly creating a full-document bitmap or managing a second page-rendering loop. PDF.js owns rendering scheduling and canvas limits. |
| PI05 | Record evidence and known limits. | Type checking, production build, focused data/coordinate checks and browser smoke checks are reported separately from physical-device gesture acceptance. Unrun checks remain pending with a reproducible procedure. |

## Acceptance boundary

The mobile usability objective is accepted only after PV03, PV04, PV05 and PV08
have physical-device evidence on the supported iOS and Android browsers. Desktop
automation or a narrow emulated viewport can validate layout and integration;
it cannot establish actual two-finger gesture quality.

OCR for image-only PDFs, importing embedded annotations into synchronized rows,
changing the sync protocol, uploading local file contents and replacing the
document library are outside this migration.
