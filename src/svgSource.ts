/** Locate an <svg>…</svg> span inside a markdown file and splice a replacement. */

export interface SvgSpan {
	start: number;
	end: number;
	inner: string;
}

const SVG_RE = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;

export function findSvgSpans(markdown: string): SvgSpan[] {
	const spans: SvgSpan[] = [];
	SVG_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = SVG_RE.exec(markdown)) !== null) {
		spans.push({ start: m.index, end: m.index + m[0].length, inner: m[0] });
	}
	return spans;
}

/**
 * Match a live DOM svg back to its source span.
 * Uses data-a1-svg when present; otherwise the Nth <svg> in the file
 * (same order Obsidian inlines them).
 */
export function matchSpan(markdown: string, domIndex: number, marker: string | null): SvgSpan | null {
	const spans = findSvgSpans(markdown);
	if (marker) {
		const hit = spans.find((s) => s.inner.includes(`data-a1-svg="${marker}"`) || s.inner.includes(`data-a1-svg='${marker}'`));
		if (hit) return hit;
	}
	if (domIndex < 0 || domIndex >= spans.length) return null;
	return spans[domIndex];
}

export function spliceSvg(markdown: string, span: SvgSpan, replacement: string): string {
	return markdown.slice(0, span.start) + replacement + markdown.slice(span.end);
}

/** Ensure the root <svg> carries a stable marker so later edits don't depend on order. */
export function ensureMarker(svgMarkup: string, marker: string): string {
	if (/data-a1-svg=/.test(svgMarkup)) return svgMarkup;
	return svgMarkup.replace(/<svg\b/, `<svg data-a1-svg="${marker}"`);
}
