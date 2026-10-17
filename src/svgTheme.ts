import { findBackgroundRectForText } from "./svgCard";

export interface EditorColors {
	background: string;
	color: string;
	border: string;
	boxShadow: string;
	caretColor: string;
}

/**
 * Parses a hex, rgb, rgba, or common named color into RGB components.
 */
export function parseColorToRgb(colorStr: string): { r: number; g: number; b: number } | null {
	if (!colorStr) return null;
	const s = colorStr.trim().toLowerCase();

	if (s.startsWith("#")) {
		const hex = s.slice(1);
		if (hex.length === 3 || hex.length === 4) {
			return {
				r: parseInt(hex[0] + hex[0], 16),
				g: parseInt(hex[1] + hex[1], 16),
				b: parseInt(hex[2] + hex[2], 16),
			};
		}
		if (hex.length >= 6) {
			return {
				r: parseInt(hex.slice(0, 2), 16),
				g: parseInt(hex.slice(2, 4), 16),
				b: parseInt(hex.slice(4, 6), 16),
			};
		}
	}

	const rgbMatch = s.match(/rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)/);
	if (rgbMatch) {
		return {
			r: parseFloat(rgbMatch[1]),
			g: parseFloat(rgbMatch[2]),
			b: parseFloat(rgbMatch[3]),
		};
	}

	const named: Record<string, { r: number; g: number; b: number }> = {
		white: { r: 255, g: 255, b: 255 },
		black: { r: 0, g: 0, b: 0 },
		gray: { r: 128, g: 128, b: 128 },
		grey: { r: 128, g: 128, b: 128 },
		silver: { r: 192, g: 192, b: 192 },
		darkgray: { r: 169, g: 169, b: 169 },
		lightgray: { r: 211, g: 211, b: 211 },
		ghostwhite: { r: 248, g: 248, b: 255 },
		whitesmoke: { r: 245, g: 245, b: 245 },
	};
	if (named[s]) return named[s];

	return null;
}

/**
 * Standard ITU-R BT.601 perceived luminance (0-255).
 */
export function getLuminance(r: number, g: number, b: number): number {
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Checks whether Obsidian is running in dark theme mode.
 */
export function isObsidianDarkTheme(): boolean {
	if (typeof document === "undefined") return true;
	if (document.body.classList.contains("theme-light")) return false;
	if (document.body.classList.contains("theme-dark")) return true;
	return true; // Default Obsidian theme is dark
}

/**
 * Retrieves the true computed background color of Obsidian workspace.
 */
export function getObsidianTrueBackground(): string {
	if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
		return isObsidianDarkTheme() ? "#1e1e1e" : "#ffffff";
	}

	const bodyCs = getComputedStyle(document.body);
	const bgPrimary = bodyCs.getPropertyValue("--background-primary").trim();
	if (bgPrimary) return bgPrimary;

	const bgSec = bodyCs.getPropertyValue("--background-secondary").trim();
	if (bgSec) return bgSec;

	const bgBody = bodyCs.backgroundColor;
	if (bgBody && bgBody !== "rgba(0, 0, 0, 0)" && bgBody !== "transparent") {
		return bgBody;
	}

	return isObsidianDarkTheme() ? "#1e1e1e" : "#ffffff";
}

/**
 * Finds the local background color directly behind an SVG text element.
 * Checks dedicated chip rects, ancestor card rects, or gradient stops.
 */
export function getSvgLocalBackground(textEl: Element): string | null {
	const svg = (textEl as SVGElement).ownerSVGElement ?? textEl.closest("svg");
	if (!svg) return null;

	const extractColor = (r: Element): string | null => {
		const fill = r.getAttribute("fill") || (r as SVGElement).style.fill;
		if (!fill || fill === "none" || fill === "transparent") return null;

		if (fill.startsWith("url(")) {
			const idMatch = fill.match(/url\(#([^)]+)\)/);
			if (idMatch) {
				const grad = svg.querySelector(`#${idMatch[1]}`);
				if (grad) {
					const stop = grad.querySelector("stop");
					const stopColor = stop?.getAttribute("stop-color") || stop?.style.stopColor;
					if (stopColor) return stopColor;
				}
			}
			return null;
		}
		return fill;
	};

	// 1. Dedicated chip/pill background
	const bgRect = findBackgroundRectForText(textEl);
	if (bgRect) {
		const c = extractColor(bgRect);
		if (c) return c;
	}

	// 2. Ancestor card rect
	let parent = textEl.parentElement;
	while (parent && parent !== svg) {
		const cardRect = parent.querySelector(":scope > rect");
		if (cardRect) {
			const c = extractColor(cardRect);
			if (c) return c;
		}
		parent = parent.parentElement;
	}

	// 3. Root SVG background rect
	const rootRect = svg.querySelector(":scope > rect");
	if (rootRect) {
		const c = extractColor(rootRect);
		if (c) return c;
	}

	return null;
}

/**
 * Resolves the true visual text color rendered on screen for an SVG text element.
 * Checks child <tspan> elements, direct fill, and ancestor group fills.
 */
export function resolveVisualTextColor(textEl: SVGTextElement): string {
	// 1. Check child <tspan> elements (e.g. <tspan fill="#f8fafc">)
	const tspans = Array.from(textEl.querySelectorAll("tspan"));
	for (const tspan of tspans) {
		const fill = tspan.getAttribute("fill") || tspan.style.fill;
		if (fill && fill !== "none" && fill !== "transparent") return fill;
		const col = tspan.style.color;
		if (col && col !== "none" && col !== "transparent") return col;
	}

	// 2. Direct fill on <text>
	const directFill = textEl.getAttribute("fill") || textEl.style.fill;
	if (directFill && directFill !== "none" && directFill !== "transparent") {
		return directFill;
	}

	// 3. Ancestor <g> fill
	let p = textEl.parentElement;
	while (p && p.tagName.toLowerCase() !== "svg") {
		const pFill = p.getAttribute("fill") || p.style.fill;
		if (pFill && pFill !== "none" && pFill !== "transparent") return pFill;
		p = p.parentElement;
	}

	// 4. ComputedStyle (if in real browser DOM)
	if (typeof getComputedStyle !== "undefined") {
		try {
			const cs = getComputedStyle(textEl);
			if (cs.fill && cs.fill !== "none" && cs.fill !== "rgba(0, 0, 0, 0)") {
				return cs.fill;
			}
			if (cs.color && cs.color !== "rgba(0, 0, 0, 0)") return cs.color;
		} catch {}
	}

	return "";
}

/**
 * Intelligently combines Obsidian's true background and the SVG context to determine
 * high-contrast, crystal-clear editor colors.
 * Guarantees text will NEVER disappear into the background!
 */
export function resolveEffectiveEditorColors(textEl: SVGTextElement): EditorColors {
	const isDark = isObsidianDarkTheme();
	const obsidianBg = getObsidianTrueBackground();
	const localBg = getSvgLocalBackground(textEl);

	// Determine effective background color & luminance
	const effectiveBg = localBg || obsidianBg;
	const bgRgb = parseColorToRgb(effectiveBg);
	const bgLum = bgRgb ? getLuminance(bgRgb.r, bgRgb.g, bgRgb.b) : (isDark ? 25 : 245);
	const isBgDark = bgLum < 128;

	// Determine visual text color
	const visualTextCol = resolveVisualTextColor(textEl);
	let finalTextColor = visualTextCol;

	if (visualTextCol) {
		const textRgb = parseColorToRgb(visualTextCol);
		if (textRgb) {
			const textLum = getLuminance(textRgb.r, textRgb.g, textRgb.b);
			// Contrast safety guard:
			// If background is dark and text color is also dark (e.g. black rgb(0,0,0)), promote to bright white!
			if (isBgDark && textLum < 90) {
				finalTextColor = "var(--text-normal, #f8fafc)";
			}
			// If background is light and text color is also light, demote to dark!
			else if (!isBgDark && textLum > 170) {
				finalTextColor = "var(--text-normal, #111827)";
			}
		}
	} else {
		// No explicit color found: default to high-contrast theme text color
		finalTextColor = isBgDark ? "var(--text-normal, #f8fafc)" : "var(--text-normal, #111827)";
	}

	// Input background: match Obsidian's true background or local card
	const inputBg = isBgDark
		? (localBg && bgLum >= 15 && bgLum <= 60 ? localBg : "var(--background-primary, #1e1e1e)")
		: "var(--background-primary, #ffffff)";

	return {
		background: inputBg,
		color: finalTextColor,
		border: "var(--interactive-accent, #7c9cff)",
		boxShadow: isBgDark
			? "0 0 0 3px color-mix(in srgb, var(--interactive-accent, #7c9cff) 35%, transparent), 0 4px 14px rgba(0, 0, 0, 0.55)"
			: "0 0 0 3px color-mix(in srgb, var(--interactive-accent, #7c9cff) 25%, transparent), 0 4px 14px rgba(0, 0, 0, 0.12)",
		caretColor: "var(--interactive-accent, #7c9cff)",
	};
}
