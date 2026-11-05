# npm Release Trust

DindbOS should publish as a serious browser runtime dependency, not as a demo bundle.

## Required Release Command

```bash
npm publish --provenance
```

Use npm provenance whenever the registry and CI provider support it. If provenance is unavailable, record the reason in release notes before publishing.

## Pre-Publish Checklist

- Run `npm run check`.
- Run `npm run smoke:sdk-pack`.
- Run `npm run smoke:create-dindbos`.
- Run `npm run smoke:release-conformance`.
- Run `npm run smoke:npm-release-trust`.
- Confirm `dindbos-npm-release-trust.json` records the tarball SHA-256.
- Confirm package contents match the `package.json` file allowlist: SDK output, package metadata, maintained documentation, licenses, and showcase assets.
- Confirm `docs/changelog.md` has user-visible release notes.
- Confirm no `.env`, local QA captures, worktrees, or release-conformance output are included in the tarball. Maintained showcase assets under `docs/assets/` are intentionally shipped.

## Evidence

Release conformance writes `dindbos-npm-release-trust.json`. It records package metadata, tarball SHA-256, package file allowlist status, required SDK entrypoints, changelog status, and the npm provenance checklist.
