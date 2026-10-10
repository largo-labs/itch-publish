# itch-publish

A GitHub Action that builds a web game, checks it against itch.io's HTML5 limits, loads it in headless
Chromium the way itch serves it, and pushes it to itch.io with [butler](https://itch.io/docs/butler/).
Used by every [Largo Labs](https://github.com/largo-labs) game repo.

## What it does

1. `npm ci`, `npm run typecheck` (if the script exists), `npm run build`.
2. `check.mjs` reads `GAME.md` front matter, then checks `dist/`:
   - `index.html` sits at the root
   - at most 500 files, 500 MB in total and 200 MB per file
   - asset paths are relative (Vite `base: './'`)
3. `smoke.mjs` serves the build from a sub-path and loads it in Chromium. It fails on uncaught errors,
   console errors or missing files, and uploads a screenshot as a run artifact.
4. When `publish` is `'true'`, it runs `butler push dist <itch-user>/<itch_slug>:html5 --userversion <version>+<sha>`.
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

## Running it locally

```bash
ITCH_USER=largolabs node check.mjs ../lastlight
npm install --no-save playwright@1.64.0 && npx playwright install --only-shell chromium
node smoke.mjs ../lastlight/dist shot.png
```

## Releasing

Game repos pin `@v1`. After a change, move the tag: `git tag -f v1 && git push -f origin v1`.
