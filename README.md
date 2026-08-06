# Jellyfin Letterboxd Link

[![License: GPL v3](https://img.shields.io/github/license/briggsyj/jellyfin-letterboxd-link)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/briggsyj/jellyfin-letterboxd-link)](../../releases)
[![CI](https://github.com/briggsyj/jellyfin-letterboxd-link/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

A small Jellyfin plugin that adds a button to a movie's detail page linking
straight to that film's [Letterboxd](https://letterboxd.com) page. No
accounts, no configuration, no background tasks.

It resolves the link from the movie's TMDb id via Letterboxd's
(undocumented but long-standing) `letterboxd.com/tmdb/{id}/` redirect, and
injects the button via the
[File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation)
plugin rather than patching jellyfin-web's files directly. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how it's wired up under the hood.

## Requirements

- Jellyfin server **10.11.x**
- The [File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation)
  plugin, installed and enabled. Without it, this plugin loads fine but no
  button appears (it retries registration for a few minutes at startup in
  case File Transformation loads afterwards).

## Installation

1. **Install [File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation)
   first** and confirm it's enabled - this plugin depends on it to inject
   its button, and won't show anything without it. Follow the install
   instructions on its GitHub page (their [`README`](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation#installation)
   covers adding their plugin repository to Jellyfin).
2. Install this plugin, either:
   - **Add as a repository** (recommended - Jellyfin then handles
     updates): in Jellyfin, go to Dashboard → Plugins → Repositories → Add
     Repository, and add
     `https://briggsyj.github.io/jellyfin-letterboxd-link/manifest.json`.
     Then find "Letterboxd Link" under Catalog and install it.
   - **Manual zip install**: download the latest release zip from
     [Releases](../../releases) and unzip it into a `LetterboxdLink` folder
     under your Jellyfin
     [plugins directory](https://jellyfin.org/docs/general/server/plugins/#adding-plugin-repositories).
3. Restart Jellyfin.

To build from source instead, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Bug reports, fixes, and small improvements are welcome - see
[CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, tests, and the release
process.

## License

[GPL-3.0](LICENSE). Jellyfin plugins link against `Jellyfin.Controller` /
`Jellyfin.Model`, which are GPLv3-licensed, so this project is too.

## Trademarks & affiliation

This is an unofficial, community-made plugin: it is **not affiliated with,
endorsed by, or sponsored by Jellyfin, Inc. or Letterboxd Limited**.
"Jellyfin" is a trademark of Jellyfin, Inc.; "Letterboxd" and the dots
device are registered trademarks of Letterboxd Limited. No logos or brand
assets from either project are used. The plugin only renders a plain
hyperlink to Letterboxd's public site, opened by the user's own browser -
it does not use Letterboxd's API, scrape the service, or access any
private data.
