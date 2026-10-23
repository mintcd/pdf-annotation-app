# ADR-0001: Use the PDF.js complete viewer

Status: Accepted

Date: 2026-10-18

Delivery status: implemented. Automated checks pass; physical mobile acceptance
remains pending. Evidence is tracked in the
[verification guide](../pdf-viewer-validation.md).

Requirements: [PV01-PV08 and PI01-PI05](../requirements/pdf-viewer.md).
Companion data/export decision:
[ADR-0002](0002-portable-annotations.md).

## Context

The user reported that EmbedPDF's mobile zooming and panning did not provide a
good experience and selected PDF.js as its replacement. The existing app has
React controls, a document library, editable outlines, highlights and comments
backed by sync-engine. Replacing its reader must retain those application flows.

PDF.js separates the parsing/display APIs from its viewer layer. Rendering
pages to canvases alone leaves scrolling, zoom interactions, text/link layers
and page rendering coordination to the application. The viewer layer is the
appropriate reuse boundary for this migration.

## Decision

### 1. Compose the upstream viewer within the existing React workspace

Use pinned `pdfjs-dist` **6.4.299**, composing its `PDFViewer`, `PDFLinkService`,
`EventBus` and `PDFFindController`. Retain the application toolbar and sidebars
as controls over that viewer. Use the packaged viewer stylesheet and rendering
resources. Keep display API, viewer code and worker on the same release.

“Complete viewer” here means the PDF.js viewer and interaction layer with its
supporting services. It does not mean importing every feature or the stock
generic viewer HTML. The application continues to own its library, notes,
annotation controls and synchronization status.

### 2. Reuse upstream touch recognition and browser selection

Connect the matching upstream `TouchManager` following PDF.js's generic
application wiring. Delegate scale updates and their origin to `PDFViewer`.
Use the scroll container for native scrolling/panning, and the PDF.js text layer
with browser-native text selection handles.

Remove the EmbedPDF plugin stack and custom mobile selection/gesture machinery
from this reader path. Mobile usability still requires physical-device
acceptance; the choice of library is not a performance or gesture-quality result.

### 3. Own the browser lifecycle and same-origin assets

Load and initialize browser APIs after mount. Each viewer/document lifetime
owns cancellation, subscriptions, worker/document work and observer cleanup.
Serve the worker and required rendering resources from application assets; do
not load a second independently versioned worker from a CDN.

Keep the existing `PdfSource` identity and remote PDF proxy. Store app
annotations through the existing sync-engine table clients as detailed in
ADR-0002.

## Alternatives considered

- **Tune the EmbedPDF gesture configuration:** potentially a smaller change,
  but does not carry out the user's selected PDF.js migration and retains the
  existing interaction integration.
- **Canvas-only PDF.js wrapper:** uses the parser/renderer but requires the app
  to implement the viewer behavior that motivated the replacement.
- **Unmodified generic viewer in an iframe:** provides stock controls but adds
  a separate document/control boundary for React sidebars, text selections and
  synchronized annotations. The modular viewer fits the existing workspace.
- **Commercial PDF SDK:** potentially offers vendor-maintained interactions and
  authoring, with licensing and a different integration boundary. The user
  selected the open-source PDF.js path.

## Consequences and verification

PDF.js owns rendering and upstream gesture recognition; the app maintains a
small composition layer and its existing controls. Upgrading the pinned release
requires checking the viewer APIs, touch wiring, CSS and asset set together.
Its browser API baseline must be tested on the intended mobile browsers.

PDF.js does not replace the app's data store, and reader integration alone is
not an outline/highlight export implementation. The separate writer and
coordinate boundary in ADR-0002 preserve those features.

The acceptance evidence includes type checking, production asset/build checks,
coordinate/export tests, browser smoke tests and physical iOS/Android gesture
checks. Results and unrun checks belong in the
[verification guide](../pdf-viewer-validation.md).

## Sources

- [PDF.js layers and distribution layout](https://mozilla.github.io/pdf.js/getting_started/).
- [PDF.js 6.4.299 generic application composition and touch wiring](https://github.com/mozilla/pdf.js/blob/v6.4.299/web/app.js).
- [PDF.js API and document lifecycle](https://mozilla.github.io/pdf.js/api/draft/api.js.html).
