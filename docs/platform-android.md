# Android mobile shell

The `android` preset is a Samsung One UI-inspired browser shell, available only in narrow desktop containers. It preserves DindbOS apps, files, permissions and running windows. It is not Samsung software or an Android emulator.

## Official research and design decisions

Reviewed 10 November 2026. The following pages describe platform conventions; the browser adaptation below is our interpretation.

| Official reference | Verified guidance | DindbOS adaptation |
| --- | --- | --- |
| [Samsung: Basic layout](https://developer.samsung.com/one-ui/layout/basic.html) | Separate an upper viewing area from a lower interaction area; group related actions. | A quiet workspace heading, app icons below it, and Apps / Quick settings near the bottom. App content retains its existing layout. |
| [Samsung: Grid system](https://developer.samsung.com/one-ui/layout/grid.html) | Use at least 24 dp side margins, account for cutouts, and adapt to different screen sizes. | 24 CSS px home margins, responsive icon columns and safe-area environment insets. CSS pixels approximate the web layout, not physical Android dp calibration. |
| [Samsung: Navigation bar](https://www.samsung.com/us/support/answer/ANS10002427/) | The classic order is Recents, Home, Back. Recents displays recently opened apps; Home returns to the home screen; Back returns to a prior screen. | Three persistent controls in that order. Recents lists real running windows. Home minimizes windows without closing them. Back dismisses shell panels, offers an app navigation event, then returns Home. |
| [Android: Accessible controls](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views) | Recommend at least 48 × 48 dp touch areas and meaningful descriptions. | At least 48 CSS px navigation targets, named controls, visible keyboard focus and a host-scoped dialog. |
| [Android: Edge-to-edge layouts](https://developer.android.com/develop/ui/views/layout/edge-to-edge) | System bars can overlap content; account for insets and visual overlap. | Reserve top and bottom space with CSS safe-area insets so app content and navigation remain separate. |

Rounded groups and a restrained palette use existing DindbOS theme tokens. Existing original app icons and wallpaper remain available. No Samsung fonts, logos, wallpaper, battery percentage or cellular indicators are copied or simulated.

## Interaction contract

- Home preserves process and component state by minimizing every visible window.
- Recents shows window titles rather than fabricated screenshots. Selecting a task restores its existing window. A nonmodal `dialog` contains keyboard Tab focus while active, supports Escape dismissal and returns focus to its trigger. Other embedded desktops remain usable.
- Back first closes an open shell panel. Otherwise the active app content receives a bubbling, cancelable `dindbos:back` event. Calling `preventDefault()` signals that the app handled its internal navigation. Without an app handler, Back goes Home without closing or discarding the app.
- Apps and Quick settings reuse the existing searchable launcher and appearance controls.
- Active app windows fill the available mobile workspace. Desktop caption controls are replaced by system navigation.

The mobile preset is selected by the host configuration; it does not detect the visitor's operating system. Native Android predictive-back animation, OS app switching, hardware keys, notification permissions, and device status are outside this browser shell's scope.

## Verification

`node scripts/smoke-platform-android.js` checks Home state preservation, shell-panel dismissal, cancelable app Back handling, and the safe fallback. Browser rendering and real-device accessibility require the integration checks recorded with the platform-shell change.
