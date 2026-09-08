# Contributing

Bug reports and small, focused PRs are welcome. This is a hobby-scale plugin;
please keep changes minimal rather than adding config or features speculatively.

## How it works

- **Server** (`Jellyfin.Plugin.LetterboxdLink`): a normal `BasePlugin`. At
  startup, `FileTransformationRegistrar` registers a transformation with the
  File Transformation plugin (via reflection, since each plugin loads in its own
  `AssemblyLoadContext`). That transformation injects a `<script>` tag into
  jellyfin-web's `index.html`, pointing at a script served by the plugin's own
  controller.

  `fileNamePattern` is an **unanchored regex**, not a file name, and File
  Transformation tests it against every path jellyfin-web serves — a literal
  `index.html` also matches e.g. `..._login_index_html.<hash>.chunk.js`, whose
  contents then get a `<script>` tag appended to them. Hence `^/?index\.html$`
  (the leading slash is optional because File Transformation matches the raw
  request subpath in `NeedsTransformation` and the slash-trimmed one in
  `RunTransformation`), plus `InjectScriptTag` refusing to touch anything with
  no closing `</body>`.
- **Client** (`Web/letterboxd-link.js`) adds the button in three places:
  - **Details page** (`#/details?id=...`): looks the item up via
    `window.ApiClient` and renders a button if the movie has a TMDb id (no id,
    no button — never a dead link). The buttons container is stamped with
    `data-letterboxd-handled="<item id>"` once resolved. The MutationObserver
    fires on every batch of DOM changes the page makes while rendering, so
    without that marker each batch would start another item lookup — and for a
    movie with no TMDb id, where the settled answer leaves no button in the DOM
    to detect, it would never stop.
  - **List view rows** (`listview.js`'s `.listItem` markup): each row already
    carries the item id and renders its own favourite/"more" buttons inside a
    `.listViewUserDataButtons` container, so a button is inserted directly
    between them. Unlike the card case below, no click-to-open-menu step is
    needed since the id is already on the row. The button's own click handler
    calls `stopPropagation()` so the click doesn't also trigger the row's
    itemAction (which would otherwise navigate to the details page).
  - **Movie cards**: adds an entry to the "more" (meatball) button's item
    context menu, after "Copy Stream URL", rather than a hover-overlay button —
    an extra hover button pushes the overlay's width out. Cards only expose the
    item id in the DOM, and the action sheet itself carries no reference back
    to the card that opened it, so the item id is captured on the "more"
    button's click (before jellyfin-web's own handler consumes it) and
    remembered briefly until the action sheet appears. The Letterboxd link
    itself then resolves on click of the new entry: open a blank tab, look the
    item up, then point the tab at Letterboxd (or close it if there's no TMDb
    id). The tab must open synchronously in the click handler, or popup blockers
    reject it after the async lookup.

All three injection points target jellyfin-web's DOM, not a stable API, so
they depend on its current markup (`.itemDetailPage`/`.mainDetailButtons`,
`.listItem[data-type]`/`.listViewUserDataButtons`,
`.card[data-type]`/`[data-action="menu"]`/`.actionSheet`/`.actionSheetScroller`).
A markup change can make a button silently disappear and need a follow-up PR —
the card menu entry most of all, as jellyfin-web is migrating cards and list
views to React under `src/apps/modern`. Confirmed as of jellyfin-web 12.0: the
item details page shell (`.itemDetailPage`/`.mainDetailButtons`) is still
legacy-rendered markup even though individual buttons like "more commands"
are now React components mounted into it, and the React list/menu components
(`ListViewUserDataButtons`, `MoreVertIconButton`) deliberately keep the same
`data-id`/`data-type`/`data-action="menu"` attributes and `.actionSheet`/
`.actionSheetScroller` markup as the legacy versions, so the existing
selectors cover both. When changing selectors, note the jellyfin-web version
you tested against.

The `letterboxd.com/tmdb/{id}/` redirect is undocumented but long-stable. If it
breaks, the fallback would be Letterboxd's public search (out of scope for now).

## Dev setup

Requires the .NET 10 SDK and Node 22.22+ (jsdom's floor; LTS 22 or 24).

```bash
dotnet test          # C# tests (mainly IndexHtmlTransformation)
npm ci && npm test   # JS tests: pure helpers + jsdom DOM/behaviour tests
```

To try a change on a real server, `dotnet publish Jellyfin.Plugin.LetterboxdLink
-c Release` and copy `bin/Release/net10.0/publish/*` into
`<jellyfin-data-dir>/plugins/LetterboxdLink/`, then restart Jellyfin.

### Jellyfin 10.11 support

`main` targets Jellyfin 12.0 (net10.0, `Jellyfin.Controller`/`Jellyfin.Model` 12.0.0).
The [`jellyfin-10.11`](../../tree/jellyfin-10.11) branch is a frozen snapshot of the
last 10.11-targeted state (net9.0, packages pinned to 10.11.11, `build.yaml`
`targetAbi: 10.11.0.0`) kept around so 10.11 users keep getting a working plugin.
Cut any 10.11 patch releases from that branch; the plugin repository manifest
accumulates versions across both, and each server only ever sees the
highest version whose `targetAbi` it satisfies. Backport fixes there only if
they don't depend on 12.0-only APIs.

## Code style

- Nullable reference types on, warnings as errors (including missing XML docs on
  public members) — `dotnet build` enforces both.
- Keep pure, testable helpers separate from DOM/browser code in
  `letterboxd-link.js` (see the CommonJS export guard); test anything that
  doesn't need a `document` or a running server.

## Releasing (maintainers)

Publishing a GitHub Release builds the plugin with
[jprm](https://github.com/oddstr13/jellyfin-plugin-repository-manager) and:

1. Attaches the `.zip`, `.md5sum`, and `.meta.json` to the release (for manual
   installs). Version comes from the tag, falling back to `build.yaml`.
2. Publishes the repository manifest to the `gh-pages` branch via `jprm repo
   add`, enabling install-by-URL in Jellyfin. `gh-pages` is created on first
   release.

`workflow_dispatch` runs only the build, skipping both steps above.

> One-time: enable Pages under Settings → Pages → Deploy from a branch →
> `gh-pages` / `(root)`, or the manifest URL won't resolve.

## License

By contributing, you agree your changes are licensed under the project's
[GPL-3.0 license](LICENSE).
