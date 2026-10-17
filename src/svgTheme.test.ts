import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import {
	getLuminance,
	getSvgLocalBackground,
	parseColorToRgb,
	resolveEffectiveEditorColors,
	resolveVisualTextColor,
} from "./svgTheme";
import { findAdjacentBadgeRect } from "./svgCard";

function doc(svg: string): { svg: Element; window: { document: Document } } {
	const { document } = parseHTML(`<!doctype html><body>${svg}</body>`);
	const el = document.querySelector("svg");
	if (!el) throw new Error("no svg");
	return { svg: el, window: { document } };
}

describe("svgTheme color parsing and luminance", () => {
	it("parses hex, rgb, rgba, and named colors correctly", () => {
		expect(parseColorToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
		expect(parseColorToRgb("#000")).toEqual({ r: 0, g: 0, b: 0 });
		expect(parseColorToRgb("#151d30")).toEqual({ r: 21, g: 29, b: 48 });
		expect(parseColorToRgb("rgb(100, 150, 200)")).toEqual({ r: 100, g: 150, b: 200 });
		expect(parseColorToRgb("rgba(248, 250, 252, 0.8)")).toEqual({ r: 248, g: 250, b: 252 });
		expect(parseColorToRgb("white")).toEqual({ r: 255, g: 255, b: 255 });
		expect(parseColorToRgb("black")).toEqual({ r: 0, g: 0, b: 0 });
		expect(parseColorToRgb("")).toBeNull();
		expect(parseColorToRgb("invalid")).toBeNull();
	});

	it("computes perceived luminance accurately", () => {
		expect(getLuminance(255, 255, 255)).toBeCloseTo(255, 1);
		expect(getLuminance(0, 0, 0)).toBe(0);
		// #151d30 is a dark card background
		const darkCardLum = getLuminance(21, 29, 48);
		expect(darkCardLum).toBeLessThan(50);
		// #f8fafc is a bright text color
		const brightTextLum = getLuminance(248, 250, 252);
		expect(brightTextLum).toBeGreaterThan(240);
	});
});

describe("svgTheme background and text color resolution", () => {
	it("finds the local card background color in SVG", () => {
		const { svg } = doc(`
<svg viewBox="0 0 880 370">
  <g transform="translate(36, 62)">
    <rect width="808" height="58" fill="#151d30" stroke="#a855f7"/>
    <text id="target" x="126" y="34">Some text</text>
  </g>
</svg>`);
		const text = svg.querySelector("#target")!;
		const bg = getSvgLocalBackground(text);
		expect(bg).toBe("#151d30");
	});

	it("extracts stop-color from linearGradient backgrounds", () => {
		const { svg } = doc(`
<svg viewBox="0 0 880 370">
  <defs>
    <linearGradient id="bgGrad">
      <stop offset="0%" stop-color="#0a0e17"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
  </defs>
  <rect width="880" height="370" fill="url(#bgGrad)"/>
  <text id="target" x="50" y="50">Header</text>
</svg>`);
		const text = svg.querySelector("#target")!;
		const bg = getSvgLocalBackground(text);
		expect(bg).toBe("#0a0e17");
	});

	it("resolves visual text color from child tspan fill attribute", () => {
		const { svg } = doc(`
<svg viewBox="0 0 880 370">
  <text id="target" x="126" y="34" font-size="14">
    <tspan fill="#f8fafc">睡够7-9h与做梦期(睡懒觉也是赚)</tspan>
    <tspan fill="#475569"> | </tspan>
  </text>
</svg>`);
		const text = svg.querySelector("#target") as SVGTextElement;
		const color = resolveVisualTextColor(text);
		expect(color).toBe("#f8fafc");
	});

	it("resolves visual text color from direct text fill attribute", () => {
		const { svg } = doc(`
<svg viewBox="0 0 880 370">
  <text id="target" x="82" y="33.5" fill="#34d399">稳糖饮食</text>
</svg>`);
		const text = svg.querySelector("#target") as SVGTextElement;
		const color = resolveVisualTextColor(text);
		expect(color).toBe("#34d399");
	});

	it("resolves high-contrast editor colors on dark card with white text", () => {
		const { svg } = doc(`
<svg viewBox="0 0 880 370">
  <g transform="translate(36, 62)">
    <rect width="808" height="58" fill="#151d30"/>
    <text id="target" x="126" y="34"><tspan fill="#f8fafc">睡够7-9h与做梦期</tspan></text>
  </g>
</svg>`);
		const text = svg.querySelector("#target") as SVGTextElement;
		const colors = resolveEffectiveEditorColors(text);
		expect(colors.color).toBe("#f8fafc");
		expect(colors.border).toBe("var(--interactive-accent, #7c9cff)");
		expect(colors.caretColor).toBe("var(--interactive-accent, #7c9cff)");
	});

	it("promotes unstyled or black text on dark background to high-contrast white so it never disappears", () => {
		const { svg } = doc(`
<svg viewBox="0 0 880 370">
  <g transform="translate(36, 62)">
    <rect width="808" height="58" fill="#151d30"/>
    <text id="target" x="126" y="34" fill="#000000">Unstyled Text</text>
  </g>
</svg>`);
		const text = svg.querySelector("#target") as SVGTextElement;
		const colors = resolveEffectiveEditorColors(text);
		// Black text on dark card MUST be promoted to white/normal text!
		expect(colors.color).toBe("var(--text-normal, #f8fafc)");
	});

	it("demotes white text on light background to high-contrast dark text so it never disappears", () => {
		const { svg } = doc(`
<svg viewBox="0 0 880 370">
  <g transform="translate(36, 62)">
    <rect width="808" height="58" fill="#ffffff"/>
    <text id="target" x="126" y="34" fill="#ffffff">White on White Text</text>
  </g>
</svg>`);
		const text = svg.querySelector("#target") as SVGTextElement;
		const colors = resolveEffectiveEditorColors(text);
		// White text on white card MUST be demoted to dark text!
		expect(colors.color).toBe("var(--text-normal, #111827)");
	});

	it("findAdjacentBadgeRect does not match unrelated content text outside badge bounds", () => {
		const { svg } = doc(`
<svg viewBox="0 0 880 370">
  <g transform="translate(36, 62)">
    <rect id="card-bg" width="808" height="58" fill="#151d30"/>
    <rect id="badge-rect" x="54" y="19" width="56" height="20" rx="5" fill="#a855f7"/>
    <text id="badge-text" x="82" y="33.5" text-anchor="middle">节律睡眠</text>
    <text id="content-text" x="126" y="34">睡够7-9h与做梦期</text>
  </g>
</svg>`);
		const badgeText = svg.querySelector("#badge-text")!;
		const contentText = svg.querySelector("#content-text")!;

		// The badge text at x=82 matches badge-rect (x=54, w=56, center=82)
		const matchBadge = findAdjacentBadgeRect(badgeText);
		expect(matchBadge).not.toBeNull();
		expect(matchBadge!.id).toBe("badge-rect");

		// The content text at x=126 is outside badge-rect (ends at 110) and MUST NOT match!
		const matchContent = findAdjacentBadgeRect(contentText);
		expect(matchContent).toBeNull();
	});
});
