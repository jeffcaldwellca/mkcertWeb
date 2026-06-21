# GitHub Pages — terminal landing

The landing site is plain static files in `docs/` (no build step):

- `docs/index.html` — the page
- `docs/assets/` — styles, scripts, screenshot
- `docs/.nojekyll` — serve as-is (skip Jekyll)

## Enable / update

1. Repo **Settings → Pages**.
2. **Source:** Deploy from a branch.
3. **Branch:** `main`, **Folder:** `/docs`. Save.
4. Wait for the deploy, then visit the published URL.

Editing any file under `docs/` and pushing to `main` redeploys automatically.

## Local preview

```bash
python3 -m http.server 8080 --directory docs
# http://localhost:8080/
```
