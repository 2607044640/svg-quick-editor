# SVG Quick Editor

Inline editor for SVG text drawn inside markdown reading views, embeds, and lightboxes. Plugin id: `svg-quick-editor`. No settings tab.

## Invariants

1. Empty or whitespace-only commit deletes the card, not just the glyphs. A card is `data-a1-card`, else the nearest `<g>` that contains exactly one `<text>`. A shared group keeps its siblings; only that `<text>` is removed.
2. The note file is the store. The live SVG DOM is edited, then the matching `<svg>…</svg>` span is spliced back with `vault.process`. `data-a1-svg` is stamped so a later edit does not depend on svg order.
3. F2 is captured only while a preview `<text>` is hovered. Nothing hovered → the key is left alone. No default hotkey is registered.
4. Ctrl+Scroll scales hovered UI cards in place around their geometric center ($t_{new} = k \cdot t_{old} + (1 - k) \cdot C$) without drifting.
5. Exit (Esc or right-click) prompts save confirmation only when `history.isDirty` is true; unmodified SVGs exit immediately.

## Router

| Subsystem | Doc | Owns | Do not put here |
| :--- | :--- | :--- | :--- |
| Card model | `./docs/modules/card-model.md` | find / commit / clone / scale / delete / serialize | Obsidian, pointer events |
| Preview session | `./docs/modules/preview-session.md` | F2 overlay, Alt+drag, Ctrl+wheel scale, file splice | card selection rules |

<!-- BEGIN USER-SPECIFIED -->
- Clearing text deletes the whole chip, not a blank string left in place.
- New chips are duplicated from an existing one (Alt+drag). There is no blank-card factory.
- Delete key removes hovered box without entering text edit mode.
<!-- END USER-SPECIFIED -->
