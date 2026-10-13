# itch-publish

A GitHub Action that builds a web game, checks it, loads it in headless Chromium and publishes it as
`game.zip` on a GitHub Release, which [LocalArcade](https://github.com/largo-labs/localarcade) installs.
Used by every [Largo Labs](https://github.com/largo-labs) game repo.

The name is historical: it used to push to itch.io too. Largo Labs games now ship only through LocalArcade.

## What it does

1. `npm ci`, `npm run typecheck` (if the script exists), `npm run build`.
2. `check.mjs` reads `GAME.md` front matter, then checks `dist/`:
   - `index.html` sits at the root
   - asset paths are relative (Vite `base: './'`)
3. `smoke.mjs` serves the build from a sub-path and loads it in Chromium. It fails on uncaught errors,
   console errors or missing files, and uploads a screenshot as a run artifact.
4. When `publish` is `'true'` (pushes to `main`, never pull requests), `release.sh` zips the build as
   `game.zip` (`index.html` at the zip root) and publishes it as a GitHub Release tagged
   `v<version>-<short commit>`, marked latest. LocalArcade installs that zip as a download, so players don't
   need Node, and spots updates when the latest tag changes. The newest 5 build releases are kept.
   If the release can't be made (for example the workflow lacks `permissions: contents: write`), the run fails.

## Usage

`.github/workflows/publish.yml` in a game repo:

```yaml
name: publish
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
concurrency:
  group: publish-${{ github.ref }}
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
          publish: ${{ github.event_name != 'pull_request' && github.ref == 'refs/heads/main' }}
```

`GAME.md` front matter is what LocalArcade shows on the store page. This action reads only:

```yaml
---
title: Last Light
build_output: dist         # optional, defaults to dist
---
```

Optional inputs: `path` (game folder, default `.`), `node-version` (default `24`), `keep-releases`
(default `'5'`, `'0'` keeps all) and `github-token` (default: the workflow's `GITHUB_TOKEN`).

## Running it locally

```bash
node check.mjs ../lastlight
npm install --no-save playwright@1.64.0 && npx playwright install --only-shell chromium
node smoke.mjs ../lastlight/dist shot.png
VERSION=0.1.0+abc1234 GH_REPO=largo-labs/lastlight bash release.sh ../lastlight/dist   # makes a real release
```

## Releasing

Game repos pin `@v1`. After a change, move the tag: `git tag -f v1 && git push -f origin v1`.
