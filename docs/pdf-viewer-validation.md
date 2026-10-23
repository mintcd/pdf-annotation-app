# PDF viewer verification and mobile acceptance

Date: 2026-10-18. Requirements: [PDF viewer](requirements/pdf-viewer.md).

## Production deployment

Deployed on 2026-10-18 to
[pdf-annotation.dangminh2208.workers.dev](https://pdf-annotation.dangminh2208.workers.dev).
Worker version: `4483759f-c720-450f-b478-dcbfd72e6478`.
Previous version: `31f30e61-6ab9-4d41-bb0c-2ecdfec4c44b`.

The final release check passed the code review, TypeScript check, all 14 Node
tests, and 27 browser tests with one intentional desktop touch skip (44.8
seconds). The production build and Wrangler deployment dry run passed before
publishing the generated Worker configuration. Deployment preserved existing
environment variables and the existing D1 binding; no database migration was
run.

Live smoke checks passed: the homepage and unauthenticated session endpoint
return HTTP 200, the PDF proxy reports HTTP 400 for a missing URL, and the
published version file reports PDF.js 6.4.299. SHA-256 comparisons matched the
checked build for the PDF.js worker, CMap, font, WASM, ICC profile, and viewer,
display, document-page and export JavaScript chunks. Chrome 155.0.8059.80
rendered the login form, switched between login and signup tabs, and reported
no browser page errors or application HTTP 5xx responses. No account was
created and no login was submitted during this check.

Physical-device gesture acceptance and authenticated cross-client sync remain
pending as recorded below.

Implementation status and observed checks are separate. In particular, the
reason for the migration is mobile usability, and no physical-device result is
implied by adopting PDF.js.

## Automated and browser checks

Run the repository checks from its root:

```sh
npm run typecheck
npm run build
npm test
npm run test:browser
```

Use focused checks for version-1 position parsing, page coordinate transforms
and PDF export, including rotated pages and an offset crop box. A document
rendering screenshot by itself cannot establish those data invariants.

Browser smoke checks should open a local PDF and a proxied remote PDF, verify
worker/resources load, use page and fit-width controls, follow an internal link
and outline entry, select text, create/edit/delete a highlight, and download and
reopen the annotated PDF. Switch documents while loading and verify that the
previous document does not reappear.

### Evidence ledger

| Check | Status | Evidence or limitation |
| --- | --- | --- |
| TypeScript | Passed | `npm run typecheck` passes, including the viewer integration and browser harness source. |
| Production build/assets | Passed | `npm run build` passes. `dist/client/pdfjs/6.4.299/` contains the matching worker, CMaps, fonts, WASM, ICC profiles, images, license and version file. |
| Coordinate/data compatibility | Passed | The focused Node suite below passes using actual PDF.js viewports: rotations 0/90/180/270, offset crop box, `UserUnit` 1/3, CSS scaling, cross-page clipping/deduplication and invalid saved geometry. |
| Existing saved-document corpus | Pending | Constructed version-1 fixtures pass. No actual legacy saved-document corpus was available for before/after visual comparison. |
| PDF export | Passed (automated) | The same suite reads output back through PDF.js and inspects highlights, colors, notes, dates, appearance and outlines. Print-intent rendering checks a colored pixel at the transformed highlight center on a rotated/cropped `UserUnit=2` page. Independent physical-device/PDF-reader visual acceptance is still pending. |
| Controller browser integration | Passed | Chromium harness checks real worker rendering, local/proxied source paths, outline/link navigation, selection/zoom alignment, simulated pinch/two-finger pan/native scrolling, and cleanup/reopen/cancel. These are emulated-device browser checks. |
| React workspace integration | Passed | Four targeted cases pass in both browser projects: selection/highlight/sidebar editing and undo/redo/delete with counts; existing-v1 reload; incoming-edit conflict protection; outline authoring and downloaded-PDF readback. The app fixture uses a test-only local row store and desktop viewport. |
| Annotation note editor | Passed | Focused browser tests cover incoming prop changes, blur persistence and note display through the real editor component. |
| Physical iOS Safari | Pending | Requires a physical device; follow the procedure below. |
| Physical Android Chrome | Pending | Requires a physical device; follow the procedure below. |
| Authenticated cross-client sync | Pending | Requires the app's authenticated session and a second client/replica. |

Update this ledger with observed results. Preserve any material environment
limitation instead of changing an unrun check to passed.

The focused suite has **14 passing tests** and no failures, run on 2026-10-18:

```sh
node --import tsx --test tests/pdfGeometry.test.ts tests/pdfExport.test.ts
```

Its output checks include unchanged-source byte preservation, source outline and
unrelated-annotation retention, stable annotation `NM` replacement on repeated
export/page moves, and nested/Unicode outline creation and clearing. See
[`pdfGeometry.test.ts`](../tests/pdfGeometry.test.ts) and
[`pdfExport.test.ts`](../tests/pdfExport.test.ts). These are data/output checks;
they do not exercise real mobile gestures or authenticated synchronization.

The browser suite uses Chrome **155.0.8059.80**, selected from the locally
installed Chrome executable by `playwright.config.ts`. It has desktop and
Pixel 7 emulation projects. The touch-specific CDP case is intentionally skipped
in the desktop project. The standalone Vite fixtures are independent of the
app's Cloudflare development runtime and do not contact the sync authority.

The final full `npm run test:browser` run on 2026-10-18 completed with **27 passed,
1 intentionally skipped** across 28 executions in 28.4 seconds, exit code 0.
The type check, all 14 Node tests and the production build also pass after the
undo-conflict guard and mobile toolbar updates.

The React integration suite has **8 passing executions** (four cases in both
projects), run on 2026-10-18:

```sh
npx playwright test tests/browser/app.spec.ts --config playwright.config.ts
```

[`app.spec.ts`](../tests/browser/app.spec.ts) mounts the real `PDFViewer`,
toolbar, sidebars, note editor, highlight-color hook and PDF.js controller.
Only the sync provider is replaced, using an isolated, reactive test table
client whose fixture state survives reload through localStorage. Native DOM
Range selection feeds the real highlight action. Tests inspect local row writes
and counts, edit color/notes, undo/redo, delete, restore existing-v1 positions,
reject stale undo after a simulated incoming row, and inspect a real downloaded
PDF through PDF.js. These cases use a desktop viewport in both projects so the
full toolbar is exercised. They do not test native IndexedDB persistence,
authentication, real network synchronization or physical touch selection.

[`viewer.spec.ts`](../tests/browser/viewer.spec.ts) separately exercises the
production viewer controller with real workers and CDP-simulated mobile touch
input. [`notes.spec.ts`](../tests/browser/notes.spec.ts) covers focused note-editor
prop/blur behavior. Passing these fixtures is not a deployed full-application or
physical-device acceptance result.

Inspection of the prior EmbedPDF engine's normalized-page path supports keeping
raw, unrotated top-left coordinates relative to the visible CropBox/MediaBox
intersection, without multiplying saved values by `UserUnit`. The compatibility
fixtures exercise this interpretation; they are not a substitute for comparison
against the user's existing annotated documents.

## Physical-device procedure

Use the built application over a device-accessible origin. Test a text PDF with
multiple pages, an internal link, a nested outline and existing highlights. Also
use a large multipage document and a fixture containing 90/180/270-degree pages
and an offset crop box. Record the PDF.js version, app revision, device model,
OS/browser versions and whether the session is signed in.

Run the following on physical iOS Safari and Android Chrome:

1. Open a remote URL through the app's existing library flow and exercise local
   bytes through a device-accessible `PdfSource` fixture. The migration does not
   add a local-file picker to the public route. Confirm the correct file and
   saved annotations load; record any network or worker error.
2. At fit width, scroll from the first page through several later pages with one
   finger. Confirm scroll remains within the document and no annotation action
   or link fires accidentally (PV04).
3. Pinch around a word near the middle, then near each edge, to about 200% and
   300%. Repeat zoom-in/zoom-out cycles. Confirm the touched content remains
   reachable, chrome is usable and text sharpens after the gesture (PV03).
4. At high zoom, pan to both horizontal edges, then move vertically to the next
   page. Repeat with a finger starting over text, blank page space and a
   highlight. Confirm no lost scroll, stuck gesture or accidental selection
   action (PV04).
5. Use zoom buttons and fit width; open/close each sidebar, rotate portrait to
   landscape and toggle chrome. Confirm fit width recalculates, page controls
   work and the selection action stays reachable (PV05).
6. Long press to select a word, extend the selection across lines and create a
   highlight. Repeat after zoom and on rotated/cropped pages. Confirm selected
   text and overlay geometry match and that a subsequent pan/pinch does not
   create another annotation (PV08, PA01-PA03).
7. Follow an outline destination and an internal PDF link, then use jump back
   and forward. Select an annotation in the sidebar and open an annotation deep
   link (PV06-PV07, PA03). Add/edit/delete an outline entry and confirm its
   destination in the downloaded PDF (PV07).
8. Change the highlight color, add a note and delete another highlight. Reload
   or reopen the same source and confirm the local rows and displayed state
   agree. With a signed-in second client, reconnect and confirm propagation;
   record this separately from local persistence (PA04-PA07).
9. Download the PDF and open it in an independent viewer. Confirm the original
   content, highlights, colors and note contents remain readable (PA08).
10. Switch files while one is loading, close/reopen the reader and retry after a
    failed remote URL. Confirm the next document has its own controls,
    annotations and loading/error state (PI02).

For a failed step, record the starting scale/page, exact gesture, expected and
observed behavior, reproduction frequency and a short screen recording if
available. A completed checklist with both devices is the release evidence for
the mobile objective; a browser capability claim is insufficient.

## Delivery notes

Implementation details and any intentionally deferred behavior are recorded in
the [architecture](architecture.md) and ADRs. Verify outline authoring, history
and export scope against the delivered controls before treating feature parity
as complete.
