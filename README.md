This branch is published as this repository's GitHub Pages site.

It's maintained automatically by `.github/workflows/release.yml`, which
runs `jprm repo add` here on every published release to build/update
`manifest.json` - the Jellyfin plugin repository manifest for this
project. See the main README on the `main` branch for how to add it as a
repository in Jellyfin.

Don't edit this branch by hand; changes will be overwritten by the next release.
