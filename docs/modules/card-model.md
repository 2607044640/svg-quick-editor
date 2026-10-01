# Card model

`src/svgCard.ts`, `src/svgSource.ts`. No Obsidian types. Vitest covers this file only.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
| :--- | :--- | :--- |
| `svgCard.ts` | Which node is the card, text commit, clone, nudge, serialize | File I/O, pointer events, CSS |
| `svgSource.ts` | Find `<svg>` spans in markdown and splice one | DOM geometry |

## Key Invariants

1. `findCard` never returns a `<g>` that contains more than one `<text>`, unless that group is marked `data-a1-card`. (Why chosen over "always delete the parent g": a board of sentences would lose every sibling.)
2. `nudge` merges a trailing `translate(x y)` instead of appending another. (Why chosen over stacking transforms: a drag of N moves would otherwise emit N translates.)
3. `serializeSvg` escapes text and attributes itself. It does not call `XMLSerializer`.

## Data Flow

1. Caller passes the hovered `<text>` or `<tspan>` to `resolveHit`.
2. `findCard` walks ancestors.
3. `commitText` either `writeText`s the trimmed string or `remove()`s `hit.owned`.
4. Clone path: `cloneCard` deep-clones, `nudge`s, rewrites `id` and `url(#id)` / `#id` references.
5. `serializeSvg` walks the root. `svgSource` splices that string into the markdown span from `matchSpan`.

## Side-effects API

| Method | Signature | Side-Effects |
| :--- | :--- | :--- |
| `resolveHit` | `(start: Element) => TextHit \| null` | Pure query |
| `commitText` | `(hit, raw: string) => CommitResult` | Mutates or removes DOM nodes |
| `cloneCard` | `(card, dx, dy) => Element` | Returns a detached clone; bumps internal id counter |
| `nudge` | `(el, dx, dy) => void` | Rewrites `transform` or x/y numeric attrs |
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
