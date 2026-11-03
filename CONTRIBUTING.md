# Contributing

Start with a concrete user-visible problem or a small example of the app you want to build. Include the browser, container size, package version/source commit, steps, expected behavior, and actual behavior. A short recording helps with window and animation issues.

## Issues and browser coverage

Use the [bug report](.github/ISSUE_TEMPLATE/bug_report.md) or [feature request](.github/ISSUE_TEMPLATE/feature_request.md) template. Dedicated templates also cover [app compatibility](.github/ISSUE_TEMPLATE/app-compatibility.md), [storage problems](.github/ISSUE_TEMPLATE/storage-loss.md), and the [browser companion](.github/ISSUE_TEMPLATE/browser-companion.md). A minimal reproduction is more useful than a full project, and reporting a bug does not require running the test suite.

Current browser and visual validation targets Google Chrome on macOS, including emulated narrow/mobile layouts. Safari, Firefox, and real mobile devices are unverified. Reports and contributions for those environments are welcome; state exactly what you tested. Avoid attaching personal documents, secrets, or browser profiles.

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

The [PR template](.github/PULL_REQUEST_TEMPLATE.md) asks for before/after behavior, actual verification results, UI evidence where relevant, and remaining limitations. Delete sections that do not apply. Write commit messages in English using `type: description`, for example `fix: preserve focus after closing a menu`.

Explain the concrete trigger and resulting behavior. Include verification results and any remaining gaps. Keep changes scoped and preserve unrelated work. Do not commit credentials, private audit documents, browser profiles, generated temporary packages, or local runtime data.

By contributing, you agree that your contribution is distributed under the project's [MIT license](LICENSE).
