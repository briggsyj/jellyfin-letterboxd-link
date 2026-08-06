# Jellyfin Letterboxd Link

A small Jellyfin plugin that adds a button to a movie's detail page linking
straight to that film's [Letterboxd](https://letterboxd.com) page.

No accounts, no configuration, no background tasks - it resolves the link
from the movie's TMDb id via Letterboxd's `https://letterboxd.com/tmdb/{id}/`
redirect and injects a single button next to the existing detail-page
buttons (Play, Shuffle, More, etc).

## How it works

- **Server side**: `Jellyfin.Plugin.LetterboxdLink` is a normal `BasePlugin`.
  At startup it registers a transformation with the
  [File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation)
  plugin that injects a `<script>` tag into jellyfin-web's `index.html`,
  pointing at a small JS file served by this plugin's own controller.
- **Client side**: that script watches for navigation to a movie's details
  page (`#/details?id=...`), looks up the item via the existing
  `window.ApiClient`, and - if the movie has a TMDb id - renders a
  Letterboxd button styled to match the built-in detail buttons. If there's
  no TMDb id, no button is rendered (no dead links).

Because the injection point is jellyfin-web's DOM rather than a private API,
this plugin depends on jellyfin-web's current details-page markup
(`.itemDetailPage`, `.mainDetailButtons`, `#/details` routing). If a future
Jellyfin release changes that structure, the button may simply stop
appearing rather than error - see `Web/letterboxd-link.js` for the retry
loop and `MutationObserver` fallback used to make injection as resilient
as reasonably possible against async page rendering.

The `https://letterboxd.com/tmdb/{id}/` redirect is undocumented and not a
committed public API. It has been stable for years and was re-verified
manually before release, but if it ever goes away the fallback would be
resolving the film via Letterboxd's public search - that's out of scope for
this version.

## Requirements

- Jellyfin server **10.11.x**
- The [File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation)
  plugin, installed and enabled *before* this plugin. It provides the
  hook this plugin uses to inject its script; without it, this plugin
  loads fine but no button ever appears. (This plugin retries registration
  for a few minutes after startup in case File Transformation loads after
  it - see `Services/FileTransformationRegistrar.cs`.)

## Installation

### Manual install

1. Download the latest release zip from the
   [Releases](../../releases) page (built by `.github/workflows/release.yml`).
2. Unzip it into a `LetterboxdLink` folder under your Jellyfin
   [plugins directory](https://jellyfin.org/docs/general/server/plugins/#adding-plugin-repositories).
3. Restart Jellyfin.

### Build from source

```bash
dotnet publish Jellyfin.Plugin.LetterboxdLink -c Release
```

Copy the contents of `Jellyfin.Plugin.LetterboxdLink/bin/Release/net9.0/publish/`
into `<jellyfin-data-dir>/plugins/LetterboxdLink/` and restart Jellyfin.

## Development

- `dotnet test` - runs the C# unit tests (mainly the HTML-injection logic
  in `IndexHtmlTransformation`).
- `npm test` - runs the injected script's unit tests (pure helpers like
  TMDb id extraction and route parsing) with Node's built-in test runner.
  No dependencies to install.

Both suites run in CI on every push and pull request (`.github/workflows/ci.yml`).

## Releasing

Publishing a GitHub Release (or running `.github/workflows/release.yml` via
`workflow_dispatch`) builds the plugin with
[jprm](https://github.com/oddstr13/jellyfin-plugin-repository-manager) and
attaches the resulting `.zip`, `.md5sum`, and `.meta.json` to the release.
The version is taken from the release tag (or the `workflow_dispatch`
input), falling back to the version in `build.yaml`.

> **Before your first release**, update the `owner` field in `build.yaml`
> to your GitHub username/org - it's currently a placeholder.

If you'd like one-click installs via a Jellyfin repository URL rather than
manual zip installs, you can host the generated `meta.json` (merged into a
running `manifest.json` with `jprm repo add`) on GitHub Pages or similar -
that's not set up here to keep the CI surface minimal.

## Out of scope (for now)

Per the original plan, these are intentionally not implemented:

- Per-user Letterboxd usernames / profile or diary links
- OAuth or credential storage
- Rating/watched-status writeback to Letterboxd
- Diary polling / background sync

## License

GPL-3.0. Jellyfin plugins link against `Jellyfin.Controller` /
`Jellyfin.Model`, which are GPLv3-licensed, so this project is too.
