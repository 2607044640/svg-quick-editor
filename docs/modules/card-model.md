# Card model

`src/svgCard.ts`, `src/svgSource.ts`. No Obsidian types. Vitest covers this file only.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
| :--- | :--- | :--- |
| `svgCard.ts` | Which node is the card, text commit, clone, nudge, serialize | File I/O, pointer events, CSS |
| `svgSource.ts` | Find `<svg>` spans in markdown and splice one | DOM geometry |

## Key Invariants

1. `findCard` never returns a `<g>` that contains more than one `<text>`, unless that group is marked `data-a1-card`. (Why chosen over "always delete the parent g": a board of sentences would lose every sibling.)
2. `nudge` merges an existing `translate(...)` in-place (even before `scale(...)`) instead of appending another.
3. `serializeSvg` escapes text and attributes itself. It does not call `XMLSerializer`.
4. `scaleCard` scales elements around geometric center $C$ using $t_{new} = k \cdot t_{old} + (1 - k) \cdot C$, assembling compact `translate(tx ty) scale(s)`.
5. `resolveScaleTarget` and `resolveDeleteTarget` protect canvas background rects, `<defs>`, `<style>`, and root `<svg>` from accidental mutation.

## Data Flow

1. Caller passes the hovered `<text>` or `<tspan>` to `resolveHit`.
2. `findCard` walks ancestors.
3. `commitText` either `writeText`s the trimmed string or `remove()`s `hit.owned`.
4. Clone path: `cloneCard` deep-clones, `nudge`s, rewrites `id` and `url(#id)` / `#id` references.
5. Scale path: `resolveScaleTarget` resolves element, `scaleCard` computes local center and updates scale transform.
6. Delete path: `resolveDeleteTarget` resolves element and removes it without text-edit mode.
7. `serializeSvg` walks the root. `svgSource` splices that string into the markdown span from `matchSpan`.

## Side-effects API

| Method | Signature | Side-Effects |
| :--- | :--- | :--- |
| `resolveHit` | `(start: Element) => TextHit \| null` | Pure query |
| `commitText` | `(hit, raw: string) => CommitResult` | Mutates or removes DOM nodes |
| `cloneCard` | `(card, dx, dy) => Element` | Returns a detached clone; bumps internal id counter |
| `nudge` | `(el, dx, dy) => void` | Rewrites `transform` or x/y numeric attrs |
| `resolveScaleTarget` | `(target: Element, cx?, cy?) => { element, svg } \| null` | Pure query |
| `scaleCard` | `(el, svg, factor) => { scale: number } \| null` | Rewrites element `transform` attribute |
| `getElementCenter` | `(el, svg) => { x, y }` | Pure query (bbox or measureBox fallback) |
| `resolveDeleteTarget` | `(target: Element, cx?, cy?) => { element, svg } \| null` | Pure query |
| `serializeSvg` | `(el: Element) => string` | Pure query |
| `findSvgSpans` | `(markdown: string) => SvgSpan[]` | Pure query |
| `matchSpan` | `(markdown, domIndex, marker) => SvgSpan \| null` | Pure query. Marker wins over index |
| `spliceSvg` | `(markdown, span, replacement) => string` | Pure. Returns a new string |
| `ensureMarker` | `(svgMarkup, marker) => string` | Pure. Inserts `data-a1-svg` if missing |

## Recipes

<adding_new_item_recipe>

1. Card rule changes belong in `findCard` (`src/svgCard.ts`). Add a case to `src/svgCard.test.ts` that fails first.
2. Do not special-case tag names of icons (`rect`, `path`) here. They go away because they are children of the removed card.

</adding_new_item_recipe>

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
