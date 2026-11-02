# Contributing

Start with a concrete user-visible problem or a small example of the app you want to build. Include the browser, container size, package version/source commit, steps, expected behavior, and actual behavior. A short recording helps with window and animation issues.

## Local development

```sh
npm ci
npm run dev
```

Use [DESIGN.md](DESIGN.md) for shared visual and interaction rules. Keep operating-system state in the runtime; custom UI should call documented actions rather than maintain a second window manager.

## Validate the change

Run the smallest relevant smoke script first. When changing public SDK or packaging contracts, also build and install the package in a consumer project.

```sh
npm run check
npm run build:sdk
npm run build
```

Use the existing scripts for app registry, window manager, CLI, storage, and SDK behavior. For browser changes, inspect the real UI at desktop and narrow/mobile sizes with normal and reduced motion. A screenshot does not verify animation timing or interaction.

A useful contribution includes the behavior change, meaningful regression coverage, updated examples/types/docs, and checks actually run. Preserve Vanilla consumers, stored user files, permissions, keyboard access, and runtime cleanup. Avoid dependency additions for behavior that the platform or existing code already provides.

## Pull requests

Explain the concrete trigger and resulting behavior. Include verification results and any remaining gaps. Keep changes scoped and preserve unrelated work. Do not commit credentials, private audit documents, browser profiles, generated temporary packages, or local runtime data.

By contributing, you agree that your contribution is distributed under the project's [MIT license](LICENSE).
