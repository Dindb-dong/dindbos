# npm Publishing

DindbOS publishes the `dindbos` package to the public npm registry.

## Initial package creation

The package must exist on npm before a trusted publisher can be attached. For the first release only:

```sh
npm whoami
npm run check
npm run smoke:window-manager
npm run build:sdk
npm run pack:dry
npm publish --access public --otp <one-time-password>
```

## Trusted Publishing

After the first publish, configure GitHub Actions as the trusted publisher:

```sh
npm trust github dindbos --file npm-publish.yml --repo Dindb-dong/dindbos --yes
npm trust list dindbos
```

The workflow file is `.github/workflows/npm-publish.yml`. It requests `id-token: write`, installs dependencies, verifies the SDK package, builds the SDK, and publishes with `npm publish --access public`.

## Release flow

1. Bump `package.json` to the next semver version.
2. Merge the release PR to `main`.
3. Create and publish a GitHub release for the matching tag.
4. Let the `Publish npm package` workflow publish through npm Trusted Publishing.
5. Confirm the published version:

```sh
npm view dindbos version dist-tags --json
```
