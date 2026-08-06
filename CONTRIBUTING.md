# Contributing

Bug reports and small, focused PRs are welcome. This is a hobby-scale
plugin - please keep changes minimal rather than adding configuration or
features speculatively.

## How it works

- **Server side**: `Jellyfin.Plugin.LetterboxdLink` is a normal
  `BasePlugin`. At startup (`Services/FileTransformationRegistrar.cs`) it
  registers a transformation with the File Transformation plugin - via
  reflection, since Jellyfin loads each plugin into its own
  `AssemblyLoadContext` - that injects a `<script>` tag into
  jellyfin-web's `index.html` (`Transformations/IndexHtmlTransformation.cs`),
  pointing at a JS file served by this plugin's own controller.
- **Client side** (`Web/letterboxd-link.js`): that script watches for
  navigation to a movie's details page (`#/details?id=...`), looks up the
  item via the existing `window.ApiClient`, and - if the movie has a TMDb
  id - renders a Letterboxd button styled to match the built-in detail
  buttons. No TMDb id means no button, rather than a dead link.

Because the injection point is jellyfin-web's DOM rather than a stable
API, this depends on current details-page markup (`.itemDetailPage`,
`.mainDetailButtons`, `#/details` routing). If a Jellyfin release changes
that structure, the button may just stop appearing - `letterboxd-link.js`
has a short retry loop and a `MutationObserver` fallback to be reasonably
resilient against async page rendering, but a markup change would still
need a follow-up PR. If you're changing selectors, please note which
jellyfin-web version you tested against.

The `letterboxd.com/tmdb/{id}/` redirect is undocumented and not a
committed public API. It's been stable for years and was manually
re-verified before the initial release; if it ever breaks, the fallback
would be resolving the film via Letterboxd's public search (out of scope
for now).

## Dev setup

Requires the .NET 9 SDK and Node 18+ (no npm dependencies to install).

```bash
dotnet restore
dotnet test          # C# tests - mainly IndexHtmlTransformation's HTML injection logic
npm test             # JS tests - pure helpers in letterboxd-link.js (TMDb id parsing, routing)
```

Both suites run in CI on every push and pull request.

To try a change against a real server:

```bash
dotnet publish Jellyfin.Plugin.LetterboxdLink -c Release
```

Copy `Jellyfin.Plugin.LetterboxdLink/bin/Release/net9.0/publish/*` into
`<jellyfin-data-dir>/plugins/LetterboxdLink/` and restart Jellyfin.

## Code style

- Nullable reference types are enabled and warnings are treated as
  errors, including missing XML doc comments on public members - `dotnet
  build` will fail loudly if either is violated.
- Keep DOM/browser logic in `letterboxd-link.js` separate from pure,
  testable helpers (see the CommonJS export guard at the top of that
  file) - anything you can unit test without a `document` or a running
  Jellyfin server, should be.

## Releasing (maintainers)

Publishing a GitHub Release (or running `.github/workflows/release.yml`
via `workflow_dispatch`) builds the plugin with
[jprm](https://github.com/oddstr13/jellyfin-plugin-repository-manager)
and attaches the resulting `.zip`, `.md5sum`, and `.meta.json` to the
release. The version comes from the release tag (or the
`workflow_dispatch` input), falling back to `build.yaml`.

> Before the first release, update the `owner` field in `build.yaml` -
> it's currently a placeholder.

For one-click installs via a Jellyfin repository URL rather than manual
zip installs, host the generated `meta.json` (merged into a running
`manifest.json` with `jprm repo add`) on GitHub Pages or similar - that's
not automated here, to keep the CI surface minimal.

## License

By contributing, you agree your changes are licensed under this
project's [GPL-3.0 license](LICENSE).
