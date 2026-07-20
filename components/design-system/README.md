# MintCD Design System

Blue Ink is the shared React design system for MintCD applications. It is kept as a Git submodule so applications can pin a reviewed design-system commit independently.

## Bundle behavior

The package is side-effect-free except for CSS and exposes one ESM entry point per component. Production bundlers such as Vite/Rollup can therefore omit components that are never imported. A component's CSS Module is reachable only through that component.

Import the small token sheet once at an application root:

```ts
import '@mintcd/design-system/tokens.css';
```

Prefer direct component entry points in application code:

```ts
import { Button } from '@mintcd/design-system/button';
import { Latex } from '@mintcd/design-system/latex';
import { Select } from '@mintcd/design-system/select';
import { TextField } from '@mintcd/design-system/text-field';
import { Panel, PanelBody, PanelHeader } from '@mintcd/design-system/panel';
import { Toolbar, ToolbarGroup } from '@mintcd/design-system/toolbar';
```

The convenience barrel is also ESM and tree-shakeable:

```ts
import { Badge, Card } from '@mintcd/design-system';
```

## Available atoms

- `Button`: primary, secondary, ghost, and destructive actions
- `IconButton`: accessible compact actions
- `TextField`: labels, help text, validation, and icon slots
- `Badge`: neutral and semantic statuses
- `Card`: default, subtle, elevated, and selected surfaces
- `Latex`: inline and display math rendered with KaTeX
- `Select`: accessible single-value selection with keyboard navigation and typeahead
- `Toolbar`: default, subtle, and floating action-group layouts
- `Panel`: structured default and glass side-panel surfaces

## Principles

- Components consume semantic `--ds-*` tokens rather than raw palette values.
- Blue communicates selection, focus, links, and primary actions.
- Annotation highlight colors remain user-controlled and outside the UI palette.
- All interactive atoms expose visible keyboard focus and disabled states.
- Motion tokens collapse when the user prefers reduced motion.

## Local development

When this repository is checked out as `annotation/design-system`, the parent application's `node_modules` satisfies the React and TypeScript peer dependencies:

```sh
npm run typecheck
```

No package is published and no GitHub remote is required for local development.
