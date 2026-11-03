# Artwork provenance

- `brand/dindbos-lockup.png`, `brand/dindbos-mark.png`: project lockup and symbol supplied by the maintainer. The built-in image editing tool removed the outer white background and enclosed white negative spaces into PNG alpha transparency. The source artwork in Downloads is unchanged. The README uses the lockup in light appearance and the symbol in dark appearance so the navy wordmark does not disappear against a dark page.
- `banner.svg`: earlier original SVG illustration retained in the repository; the README now uses the supplied brand assets.
- `desktop.png`, `desktop-dark.png`, `desktop-empty.png`, `mobile.png`, `applications.png`, `files-context-menu.png`, `settings-wallpaper.png`, `control-center.png`, `react-app.png`, and `demo.webm`: actual browser screenshots and a recorded interaction sequence, regenerated from the current source with `npm run capture:showcase` on 2026-11-03. No UI is composited into them. The capture enters sample Notes content and performs real Calculator, file-menu, and React app interactions in a fresh browser context.
- `src/styles/wallpapers/meadow.jpg` (shipped as `dist/wallpapers/meadow.jpg`): original landscape image generated for this project using the built-in image-generation tool. It is not an Apple wallpaper or a photograph credited to an external photographer.
- `public/wallpapers/alpine.svg`: original SVG landscape made for dindbOS, retained as a lightweight alternative.
- App icons: original SVG artwork in the dindbOS source.

Wallpaper prompt: original serene green alpine lake, granite distant peaks, morning mist, medium-format landscape photography; no text, branding, or UI. The project copy is `src/styles/wallpapers/meadow.jpg`.

macOS design references guide layout and interaction; Apple screenshots, logos, system icons, and wallpapers are not bundled as project artwork. External project links retain their own licenses.

## Reproduce the screenshots

```sh
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run capture:showcase
```

The capture runs headlessly without touching an existing browser profile. Desktop screenshots are 1440×900 and the narrow Notes screenshot is 390×844; the latter is Chrome emulation, not a real mobile-device compatibility claim. Browser versions and capture source are recorded with the local review evidence under ignored `internal/docs/qa/`.
