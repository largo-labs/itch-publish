# itch-publish

A GitHub Action that builds a web game, checks it against itch.io's HTML5 limits, loads it in headless
Chromium the way itch serves it, pushes it to itch.io with [butler](https://itch.io/docs/butler/) and
attaches it to a GitHub Release for [LocalArcade](https://github.com/largo-labs/localarcade).
Used by every [Largo Labs](https://github.com/largo-labs) game repo.

## What it does

1. `npm ci`, `npm run typecheck` (if the script exists), `npm run build`.
2. `check.mjs` reads `GAME.md` front matter, then checks `dist/`:
   - `index.html` sits at the root
   - at most 500 files, 500 MB in total and 200 MB per file
   - asset paths are relative (Vite `base: './'`)
3. `smoke.mjs` serves the build from a sub-path and loads it in Chromium. It fails on uncaught errors,
   console errors or missing files, and uploads a screenshot as a run artifact.
4. When `publish` is `'true'` (pushes to `main`, never pull requests), `release.sh` zips the build as
   `game.zip` (`index.html` at the zip root) and publishes it as a GitHub Release tagged `v<version>-<sha>`,
   marked latest. LocalArcade installs that zip as a download instead of building the game from source,
   and spots updates when the latest tag changes. Only the newest 5 build releases are kept. The workflow
   needs `permissions: contents: write`; without it the release is skipped with a warning.
5. When `publish` is `'true'`, it runs `butler push dist <itch-user>/<itch_slug>:html5 --userversion <version>+<sha>`.
   Without an API key, or before the game's itch page exists, it skips the push with a warning.

## Usage

`.github/workflows/itch.yml` in a game repo:

```yaml
name: itch
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
concurrency:
  group: itch-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
permissions:
  contents: write   # lets main publish game.zip as a GitHub Release
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: largo-labs/itch-publish@v1
        with:
          itch-user: largolabs
          butler-api-key: ${{ secrets.BUTLER_API_KEY }}
          publish: ${{ github.event_name != 'pull_request' && github.ref == 'refs/heads/main' }}
```

`GAME.md` needs at least:

```yaml
---
title: Last Light
itch_slug: last-light      # the page must already exist on itch (butler can't create pages)
build_output: dist         # optional, defaults to dist
---
```

Optional inputs: `github-release: 'false'` turns the GitHub Release off, `keep-releases` (default `'5'`,
`'0'` keeps all) and `github-token` (default: the workflow's `GITHUB_TOKEN`).

## Running it locally

```bash
ITCH_USER=largolabs node check.mjs ../lastlight
npm install --no-save playwright@1.64.0 && npx playwright install --only-shell chromium
node smoke.mjs ../lastlight/dist shot.png
VERSION=0.1.0+abc1234 GH_REPO=largo-labs/lastlight bash release.sh ../lastlight/dist   # makes a real release
```

## Releasing

Game repos pin `@v1`. After a change, move the tag: `git tag -f v1 && git push -f origin v1`.
