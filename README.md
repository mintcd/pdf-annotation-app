# PDF Annotation App

A PDF reader and annotation workspace built with React, Vinext, Vite and
Tailwind. PDF.js provides the viewer; the Vinext sync integration persists document
metadata, highlights, notes and highlight colors.

## Development

```sh
npm install
npm run db:local:migrate
npm run dev
```

The development server listens on port 3000. Run `npm run typecheck` for the
TypeScript check and `npm run build` for a production build. Database setup and
deployment use the scripts in `package.json`. Development uses local D1 by
default; setting `SYNC_REMOTE_BINDINGS=true` explicitly enables remote bindings.
`npm start` previews the built Worker locally through the Cloudflare Vite plugin.

The local sync packages are pinned as tarballs under `vendor/`. The app starts
with a fresh sync store for this migration. On first opening each new deployment,
it rebuilds the browser replica from the signed-in account's materialized D1
snapshot and resumes deltas from that snapshot's sequence. Pending offline edits
block replacement and remain retained. Reloading the same deployment resumes its
existing replica.

Before releasing this sync migration, apply `npm run db:remote:sync-migrate` to
create the new sync/session tables. It preserves existing accounts and does not
adopt legacy synced data. Then `npm run deploy` builds and deploys the generated
Worker through Wrangler. Historical SQL files are retained for reference;
rerunning the legacy initial migration would reset its seeded account.

Run `npm test`, `npm run test:browser` and `npm run test:sync` for unit, viewer
and real local-D1 browser checks respectively. The last requires the local
migrations above. See the [sync verification ledger](docs/sync-engine-validation.md).

## Documentation

Start at the [documentation index](docs/README.md). The PDF.js migration has
[behavioral requirements](docs/requirements/pdf-viewer.md), an
[architecture description](docs/architecture.md), numbered
[architecture decision records](docs/adr/0001-pdfjs-viewer.md), and a
[verification and mobile acceptance guide](docs/pdf-viewer-validation.md).

Physical-device gesture acceptance is tracked separately from automated checks;
selecting PDF.js alone does not establish that the mobile experience meets the
requirements.
