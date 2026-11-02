# __PROJECT_NAME__

This project embeds dindbOS. Keep the OS runtime in the dependency; customize host config, app components, theme tokens, and documented UI slots.

- Run `npm run build` after coherent changes.
- Apps are registered in `src/apps/index.js`. Preserve the `dindbos:imports` and `dindbos:apps` markers; the CLI uses them when adding an app.
- Add an app: `npm exec --package=dindbos -- create-dindbos add app notes --yes --json`.
- Inspect setup: `npm exec --package=dindbos -- create-dindbos doctor --json`.
- Preserve unrelated files. Do not overwrite the project or reset stored data.
- Keep permissions narrow. Installed package apps and trusted host components have different trust boundaries.
- Validate real app launch, keyboard interaction, and persistence when relevant. Report unverified behavior.
- Do not publish, deploy, or push without user authorization.
