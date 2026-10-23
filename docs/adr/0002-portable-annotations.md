# ADR-0002: Preserve portable annotation positions and application-owned sync

Status: Accepted

Date: 2026-10-18

Delivery status: implemented. Constructed data/coordinate, export and browser
integration checks pass; actual legacy-document comparison and authenticated
cross-client checks remain pending. Evidence is tracked in the
[verification guide](../pdf-viewer-validation.md).

Requirements: [PA01-PA08 and PV07](../requirements/pdf-viewer.md).
Extends [ADR-0001](0001-pdfjs-viewer.md).

## Context

Existing highlights are synchronized application rows with stable IDs, text,
color, comments and JSON position data. Positions are version 1, use zero-based
page indexes, and contain unrotated top-left page rectangles. Users must retain
those annotations when the rendering library changes.

Inspection of the prior EmbedPDF engine's normalized-page path supports raw
page units relative to the visible CropBox/MediaBox intersection; saved values
are not multiplied by `UserUnit`. Constructed compatibility fixtures verify that
interpretation. An actual legacy saved-document corpus was not available for a
visual before/after comparison, which remains a separate pending check.

PDF.js viewports use transforms for scale, page rotation, crop origin and page
units. Browser selection rectangles are CSS pixels, while PDF annotations use
PDF user-space rectangles and quad points. Treating any two of these coordinate
systems as interchangeable would shift saved or exported highlights.

The app also allows editing document outlines and downloading PDFs with app
annotations. PDF.js is the reading/viewer dependency; those authoring features
need a separate explicit output path.

## Decision

### 1. Preserve the existing persisted contract

Retain the application document keys, row IDs, table schema, sync-engine
provider and session/stream behavior. Preserve `version: 1`,
`kind: "pdf-highlight"`, `pageIndex`, `rect` and `segmentRects` as stored data.
Validate saved positions before rendering and avoid mutating rows merely
because a viewer has mounted or received a sync update.

Keep the coordinate contract independent of both the retired EmbedPDF types
and PDF.js object serialization. Introduce local rectangle types for the
unchanged data shape. A rendering-library migration does not justify resetting
IndexedDB or writing new database migrations.

### 2. Convert at the viewer boundary

Convert browser selection rectangles through the relevant page viewport into
the canonical unrotated top-left page coordinate system. Convert the same saved
coordinates back through the current viewport when rendering app highlights.
Handle crop-box offsets, page rotation and `UserUnit` explicitly.

For a multi-page text range, create a separate row and geometry for each
selected page. Keep selected text and per-line/segment rectangles. Never persist
zoom, device pixel ratio, scroll offset or DOM client coordinates as annotation
geometry.

### 3. Keep application rows as the annotation source of truth

Highlight overlays and the annotation sidebar project the existing local rows.
Color/comment/delete actions use the existing table client. Remote updates
change that projection; they do not trigger a second local mutation. PDF.js
editor storage is not another persistence or delivery queue.

Existing embedded annotations may be rendered by PDF.js without automatically
creating app rows. Document download is an output operation, distinct from
local persistence and remote synchronization.

Undo/redo remains bounded reader-session history. Before replaying a historical
row, compare its expected content with the current table row, ignoring only its
update timestamp. On an observed incoming change or deletion, clear stale
history and report the conflict without writing. This preserves incoming data
already visible locally; it does not add a server-side conditional mutation or
a synchronized history log.

### 4. Use a companion writer for PDF output

Use pinned `pdf-lib` **1.17.1** to load the original source bytes and write
standard PDF highlight annotations with colors and note contents. Derive PDF
user-space rectangles and quad points from the same canonical geometry used by
the screen overlays.

Preserve editable outline functionality in app session state, resolve original
destinations through PDF.js, and include edited outlines in downloaded output.
Outline edits are not a new synchronized collection or a remote-file write.
Keep original input bytes available: local PDF.js worker transfers must receive
a copy, and exporting must not depend on a detached input buffer.

## Alternatives considered

- **Store PDF.js editor objects:** couples durable app rows to a viewer-specific
  format and requires migrating existing annotations and sync behavior.
- **Store CSS rectangles or percentages:** loses the existing page coordinate
  contract and complicates rotation, crop offsets and independent PDF output.
- **Use PDF.js editor storage as a second source of truth:** adds reconciliation
  and echo-write risks between editor state and synchronized rows.
- **Download only the untouched source:** drops application highlights, notes
  and edited outlines from a feature the app already exposes.
- **Flatten highlights as painted page content:** reduces editability and note
  interoperability compared with standard highlight annotations.

## Consequences and verification

Existing data stays readable without a database reset or sync-engine upgrade.
The app owns its small coordinate conversion and output layer and must test it
independently of whether a canvas looks correct at fit width.

Focused tests must round-trip saved rectangles through rotated/cropped/user-unit
viewports and inspect output highlight quad points, colors, note contents and
outline structure. A browser check must verify new selection geometry and saved
overlays agree after zoom. A second authenticated client is needed to observe
actual cross-client synchronization; retaining the same engine alone is not
that evidence.

Writer limitations are surfaced as export errors. Output is a new downloaded
file, not an update to the original URL or local file. Reopening downloaded
content does not automatically import its embedded highlights into app rows.

## Sources

- [Existing position and row boundary](../../utils/pdfSync.ts).
- [PDF.js page viewport API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html).
- [PDF.js document data and lifecycle APIs](https://mozilla.github.io/pdf.js/api/draft/api.js.html).
- [pdf-lib document loading and saving API](https://pdf-lib.js.org/docs/api/classes/pdfdocument).
