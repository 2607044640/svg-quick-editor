# Preview session

`src/main.ts` (pointer + file), `src/editorOverlay.ts` (the input box), `src/styles.css`.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
| :--- | :--- | :--- |
| `main.ts` | Hover, F2, double-click, Alt+drag, `vault.process` | Card selection rules (those stay in `svgCard.ts`) |
| `editorOverlay.ts` | Fixed-position input, IME guard, Enter/Escape/blur | SVG mutation |
| `styles.css` | Overlay chrome and hover outline | Layout of the user's SVG |

## Key Invariants

1. Listeners are registered with `registerDomEvent` and torn down by Obsidian. `onunload` only closes the overlay. (Why chosen over detaching leaves: cookbook lifecycle — do not detach workspace leaves on unload.)
2. The input is `position: fixed` on `document.body` using `getBoundingClientRect` of the `<text>`. It is not appended inside the SVG.
3. `persistSvg` always goes through `app.vault.process`, then drops the hover reference because the reading view rebuilds the DOM.
4. `onWheel` registers with `{ capture: true, passive: false }` to prevent Electron from triggering whole-app zoom on Ctrl+Wheel.
5. Overlay input removal restores focus to `.a1-svg-modal-dialog` or `.svg-lightbox-modal` so subsequent Escape keys are captured cleanly.

## Data Flow

1. `pointermove` on `document` hit-tests `composedPath()` for a `<text>` inside `.markdown-preview-view` or `.markdown-rendered`.
2. Hover adds `a1-svg-hover-text`. F2 or double-click calls `beginEdit`.
3. `openTextOverlay` focuses and selects the current string.
4. Enter or blur calls `commitText` then `persistSvg`. Escape closes with no write; input removal restores dialog focus.
5. Alt+primary-button on a chip clones it via `cloneCard`, then pointer moves call `nudge` in SVG user units (`getScreenCTM().inverse()`). Pointer-up persists once.
6. Ctrl+Scroll on hovered card intercepts wheel, calls `scaleCard`, records snapshot, and displays scale percentage toast.
7. Delete key on hovered card calls `deleteHoveredBox`, removes DOM node, and persists or marks dirty.
8. `matchSpan` prefers `data-a1-svg`. The attribute is written onto the serialized root if absent.

## Side-effects API

| Method | Signature | Side-Effects |
| :--- | :--- | :--- |
| `onload` | `() => Promise<void>` | Registers DOM listeners and commands |
| `openTextOverlay` | `(parent, OverlayOptions) => OverlayHandle` | Appends `<input>` to `parent`; closes with focus restoration |
| `persistSvg` | private `(svg) => Promise<void>` | `vault.process` replaces one `<svg>` span |
| `scaleHoveredBox` | `(factor: number) => boolean` | Scales hovered UI box and records snapshot |
| `deleteHoveredBox` | `() => boolean` | Deletes hovered UI box and records snapshot |
| `promptSaveConfirmation` | `(onSave, onDiscard, onCancel) => void` | Renders dirty save confirmation dialog |

## Recipes

<adding_new_item_recipe>

1. A new gesture (context menu, another modifier) is a `registerDomEvent` in `onload` of `src/main.ts`, not a command hotkey.
2. Commands stay hotkey-free. The user binds F2 in Settings → Hotkeys only if they want it without hover; the hover path is a DOM listener on purpose, because a command cannot see the pointer target.

</adding_new_item_recipe>

<!-- BEGIN USER-SPECIFIED -->
- F2 while hovering is the primary edit gesture, matching a file-rename field.
- Alt+drag duplicates. There is no "insert blank chip" command.
<!-- END USER-SPECIFIED -->
