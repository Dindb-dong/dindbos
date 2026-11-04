# SDK Deployment Recipes

DindbOS can run in any modern browser page, but advanced package and worker paths are only fully enabled when the host deployment is origin-isolated.

## Netlify Static Site

Use `examples/deployment/netlify.toml` or add equivalent headers:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
    Cross-Origin-Resource-Policy = "same-origin"
```

Expected result: `crossOriginIsolated=true` when all scripts, workers, WASM modules, fonts, and package assets are same-origin or send compatible CORS/CORP headers.

## Static Server

Use `examples/deployment/static-headers.txt` as the required response header set:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Expected result: `crossOriginIsolated=true` on HTTPS or localhost.

## GitHub Pages

Generate a host with an opt-in deployment workflow:

```sh
npm exec --package=dindbos -- create-dindbos my-portfolio --template react --pages --yes --json
cd my-portfolio
npm install
npm run build
```

Commit `package-lock.json` with the host source; `.github/workflows/pages.yml` uses `npm ci` and uploads `dist` (not the SDK demo's `dist-demo`). It defaults to pushes on `main` and manual dispatch; adapt the branch filter for an existing repository. Enable **Settings → Pages → Source → GitHub Actions** before running it. The workflow's Pages metadata supplies Vite's base path for user sites, project sites, and custom domains. Use `import.meta.env.BASE_URL` for host public asset links. The CLI only writes files; it never creates a repository, changes Pages settings, or pushes.

For agent-led intake, repository creation, authentication recovery, source-tarball installs, and live verification, follow [the portfolio skill](../skills/dindbos-portfolio/SKILL.md). If using an unpublished SDK, commit its tarball inside the host and install it through a relative `file:vendor/...` dependency so GitHub Actions can reproduce the install. Keep original resumes and private intake outside the public repository.

Check the deployment for the exact commit and open its returned Pages URL to verify content, app launch, and assets. Local builds do not prove a remote deployment succeeded. See [GitHub's custom workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [Vite's Pages path guidance](https://vite.dev/guide/static-deploy#github-pages).

GitHub Pages does not let a repository configure COOP/COEP/CORP headers for every route.

Expected result: DindbOS boots in degraded mode. Terminal, Files, VFS, storage, packages, and most GUI apps continue to work, but SharedArrayBuffer and strict origin-isolated package profiles are unavailable.

## Local Dev

Default Vite dev servers usually run without COOP/COEP/CORP headers.

Expected result: degraded mode unless the host adds a local middleware or reverse proxy that sets the origin-isolated headers.

## Verification

Inside DindbOS, run:

```text
doctor isolation
cat /proc/isolation.json
```

Release evidence also records deployment recipes in `dindbos-deployment-recipes.json` and links them from `dindbos-release-evidence-matrix.json`.
