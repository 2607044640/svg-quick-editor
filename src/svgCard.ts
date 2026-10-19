/** Pure SVG card model. No Obsidian APIs — unit-tested with linkedom. */

export interface TextHit {
	textEl: Element;
	card: Element;
	/** Elements removed when the edited string is empty. */
	owned: Element[];
}

function localName(el: Element): string {
	return el.localName || el.tagName.toLowerCase().replace(/^.*:/, "");
}

function isTextNode(el: Element): boolean {
	const name = localName(el);
	return name === "text" || name === "tspan";
}

function countTexts(el: Element): number {
	return el.querySelectorAll("text").length;
}

function getCoords(el: Element): { x: number; y: number } | null {
	const x = num(el.getAttribute("x")) ?? num(el.querySelector("tspan")?.getAttribute("x") ?? null);
	const y = num(el.getAttribute("y")) ?? num(el.querySelector("tspan")?.getAttribute("y") ?? null);
	if (x != null && y != null) return { x, y };
	const tr = el.getAttribute("transform") ?? "";
	const m = tr.match(/translate\(\s*([-\d.]+)\s*[ ,]\s*([-\d.]+)\s*\)/);
	if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
	return null;
}

function isCardSizedRect(rect: Element, svg: Element | null): boolean {
	const w = num(rect.getAttribute("width"));
	const h = num(rect.getAttribute("height"));
	if (w == null || h == null || w <= 0 || h <= 0) return false;
	if (!svg) return true;
	const vb = (svg.getAttribute("viewBox") ?? svg.getAttribute("viewbox") ?? "").trim().split(/[\s,]+/);
	const svgW = vb.length === 4 ? parseFloat(vb[2]) : num(svg.getAttribute("width"));
	const svgH = vb.length === 4 ? parseFloat(vb[3]) : num(svg.getAttribute("height"));
	if (svgW && svgH && w >= svgW * 0.85 && h >= svgH * 0.85) return false;
	return true;
}

export function wrapInChipGroup(elA: Element, elB: Element): Element {
	const parent = elA.parentElement;
	if (!parent) return elA;
	const doc = elA.ownerDocument || document;
	const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
	g.setAttribute("class", "a1-svg-chip");

	const isFollowing = typeof elA.compareDocumentPosition === "function"
		? (elA.compareDocumentPosition(elB) & 4) !== 0
		: true;
	const first = isFollowing ? elA : elB;
	const second = (first === elA) ? elB : elA;

	parent.insertBefore(g, first);
	g.appendChild(first);
	g.appendChild(second);
	return g;
}

export function findAdjacentBadgeRect(textEl: Element): Element | null {
	const parent = textEl.parentElement;
	if (!parent) return null;
	const coords = getCoords(textEl);
	if (!coords) return null;
	const tx = coords.x;
	const ty = coords.y;

	const anchor = (textEl.getAttribute("text-anchor") || "").toLowerCase();

	const rects = Array.from(parent.children).filter((c) => localName(c) === "rect");
	for (const r of rects) {
		const w = num(r.getAttribute("width")) ?? 0;
		const h = num(r.getAttribute("height")) ?? 0;
		if (w <= 4 || h <= 4) continue; // Skip thin divider lines
		if (w > 220 || h > 50) continue; // Skip full card background (badges are small tags/chips)

		const rx = num(r.getAttribute("x")) ?? 0;
		const ry = num(r.getAttribute("y")) ?? 0;

		// Y must be vertically aligned with the badge
		if (ty < ry - 5 || ty > ry + h + 20) continue;

		// X must be within or centered on the badge bounds
		if (anchor === "middle") {
			const badgeCx = rx + w / 2;
			if (Math.abs(tx - badgeCx) <= Math.max(w * 0.45, 16)) {
				return r;
			}
		} else {
			// Left-aligned text must start inside the badge rect
			if (tx >= rx - 5 && tx <= rx + w * 0.7) {
				return r;
			}
		}
	}
	return null;
}

/**
 * Resolves what element should be cloned on Alt+drag:
 * - If mouse is on a small text or small chip/sub-box (小框): clone ONLY the small box / text.
 * - If mouse is on the outer card background / border outside the small box (小框外面): clone the large card (大框).
 * - Never clone the entire SVG canvas background.
 */
export function resolveCloneTarget(target: Element, clientX?: number, clientY?: number): Element | null {
	if (!target) return null;
	const hasInstanceOf = "instanceOf" in target && typeof (target as { instanceOf?: (cls: unknown) => boolean }).instanceOf === "function";
	const isSvgRoot = (hasInstanceOf ? (target as { instanceOf: (cls: unknown) => boolean }).instanceOf(SVGSVGElement) : false) || localName(target) === "svg";
	if (isSvgRoot) return null;

	const svg = target.closest("svg");
	if (!svg) return null;

	// 0. If target is the entire canvas background rect, ignore
	if (localName(target) === "rect" && !isCardSizedRect(target, svg)) {
		return null;
	}

	// 1. If target is text or tspan (小文字/小框)
	const textNode = asText(target);
	if (textNode) {
		let dedicatedChip: Element | null = null;
		let curr: Element | null = textNode.parentElement;
		while (curr && curr !== svg) {
			if (localName(curr) === "g") {
				if (countTexts(curr) === 1) {
					dedicatedChip = curr;
				} else {
					break;
				}
			}
			curr = curr.parentElement;
		}

		if (dedicatedChip) {
			return dedicatedChip;
		}

		const badge = findAdjacentBadgeRect(textNode);
		if (badge) {
			return wrapInChipGroup(badge, textNode);
		}

		return textNode;
	}

	// 2. If target is a rect
	if (localName(target) === "rect") {
		const w = num(target.getAttribute("width")) ?? 0;
		const h = num(target.getAttribute("height")) ?? 0;
		const isDashed = target.hasAttribute("stroke-dasharray");
		// A sub-box, badge, button, row box, or dashed box has compact height or is dashed
		const isSmall = (w > 4 && h > 4 && ((h <= 85 && w <= 420) || isDashed || (w <= 240 && h <= 120)));

		if (isSmall) {
			const parentG = target.closest("g");
			if (parentG && parentG !== svg && countTexts(parentG) === 1) {
				return parentG;
			}
			const associatedText = findTextInCard(target, clientX, clientY);
			if (associatedText && associatedText.parentElement === target.parentElement) {
				return wrapInChipGroup(target, associatedText);
			}
			return target;
		}

		// Target is the outer card background rect (大框背景)
		const cardGroup = target.closest("g");
		if (cardGroup && cardGroup !== svg) {
			return cardGroup;
		}
	}

	// 3. If target is another small element (circle, path, etc.)
	const name = localName(target);
	if (name === "circle" || name === "path") {
		const parentG = target.closest("g");
		if (parentG && parentG !== svg && countTexts(parentG) === 1) {
			return parentG;
		}
	}

	// 4. Fallback: check ancestor card <g>
	let node: Element | null = target;
	while (node && node !== svg) {
		if (node.hasAttribute("data-a1-card")) return node;
		if (localName(node) === "g") {
			const rects = Array.from(node.querySelectorAll("rect")).filter((r) => isCardSizedRect(r, svg));
			if (rects.length >= 1) return node;
		}
		node = node.parentElement;
	}

	return null;
}

/**
 * Resolves what element should be removed when user presses Delete over a hovered element:
 * - If target is a small box / chip / text, deletes that small box / text.
 * - If target is an outer card background or border, deletes the card group.
 * - Never deletes the root <svg>, <defs>, <style>, [data-a1-align], or canvas-filling background rect.
 */
export function resolveDeleteTarget(target: Element, clientX?: number, clientY?: number): { element: Element; svg: SVGSVGElement } | null {
	if (!target) return null;
	const hasInstanceOf = "instanceOf" in target && typeof (target as { instanceOf?: (cls: unknown) => boolean }).instanceOf === "function";
	const isSvgRoot = (hasInstanceOf ? (target as { instanceOf: (cls: unknown) => boolean }).instanceOf(SVGSVGElement) : false) || localName(target) === "svg";
	if (isSvgRoot) return null;

	const svg = (target.ownerSVGElement ?? target.closest("svg")) as SVGSVGElement | null;
	if (!svg) return null;

	// Never delete align guides, overlay UI, defs, or style
	if (target.closest("[data-a1-align], .a1-svg-edit, defs, style, marker")) return null;

	// Do not delete canvas-sized background rect
	if (localName(target) === "rect" && !isCardSizedRect(target, svg)) {
		return null;
	}

	const resolved = resolveCloneTarget(target, clientX, clientY);
	if (!resolved || resolved === svg) return null;

	const name = localName(resolved);
	if (name === "svg" || name === "defs" || name === "style" || name === "marker") {
		return null;
	}

	return { element: resolved, svg };
}

/**
 * Resolves what element should be scaled when user scrolls Ctrl+wheel over an element:
 * - If target is a small box / chip / text, scales that small box / text.
 * - If target is an outer card background or border, scales the card group.
 * - Never scales the root <svg>, <defs>, <style>, [data-a1-align], or canvas-filling background rect.
 */
export function resolveScaleTarget(target: Element, clientX?: number, clientY?: number): { element: Element; svg: SVGSVGElement } | null {
	if (!target) return null;
	const hasInstanceOf = "instanceOf" in target && typeof (target as { instanceOf?: (cls: unknown) => boolean }).instanceOf === "function";
	const isSvgRoot = (hasInstanceOf ? (target as { instanceOf: (cls: unknown) => boolean }).instanceOf(SVGSVGElement) : false) || localName(target) === "svg";
	if (isSvgRoot) return null;

	const svg = (target.ownerSVGElement ?? target.closest("svg")) as SVGSVGElement | null;
	if (!svg) return null;

	// Never scale align guides, overlay UI, defs, or style
	if (target.closest("[data-a1-align], .a1-svg-edit, defs, style, marker")) return null;

	// Do not scale canvas-sized background rect
	if (localName(target) === "rect" && !isCardSizedRect(target, svg)) {
		return null;
	}

	const resolved = resolveCloneTarget(target, clientX, clientY);
	if (!resolved || resolved === svg) return null;

	const name = localName(resolved);
	if (name === "svg" || name === "defs" || name === "style" || name === "marker") {
		return null;
	}

	return { element: resolved, svg };
}

/**
 * Card = the box that should disappear with this sentence.
 * 1. Ancestor (or self) with data-a1-card.
 * 2. Nearest <g> that contains exactly one <text> (a single-sentence chip).
 * 3. Nearest card-sized group (for cloning via Alt+drag).
 * 4. Otherwise only the <text>.
 */
export function findCard(textEl: Element): Element {
	const textRoot = localName(textEl) === "tspan" ? (textEl.closest("text") ?? textEl) : textEl;
	let node: Element | null = textRoot;
	let singleTextGroup: Element | null = null;
	let multiTextCard: Element | null = null;
	const svg = textRoot.closest("svg");
	while (node) {
		if (node.hasAttribute("data-a1-card")) return node;
		const name = localName(node);
		if (name === "g") {
			if (singleTextGroup == null && countTexts(node) === 1) {
				singleTextGroup = node;
			}
			if (multiTextCard == null) {
				const rects = Array.from(node.querySelectorAll("rect")).filter((r) => isCardSizedRect(r, svg));
				if (rects.length >= 1) {
					multiTextCard = node;
				}
			}
		}
		if (name === "svg") break;
		node = node.parentElement;
	}
	return singleTextGroup ?? multiTextCard ?? textRoot;
}

/**
 * Elements removed when the edited string is empty.
 * CRITICAL RULE:
 * - If textRoot is wrapped inside a dedicated single-sentence chip/sub-box (<g> with countTexts === 1):
 *   Delete that dedicated chip (<g> and its background/border).
 * - If textRoot is inside a multi-text card / container (大框, countTexts > 1) and has no dedicated sub-box:
 *   STRICTLY DELETE ONLY THIS TEXT NODE (or tspan).
 *   NEVER DELETE THE OUTER CARD, BACKGROUND RECT, BORDER, OR SIBLING TEXTS!
 */
function collectOwned(card: Element, textEl: Element): Element[] {
	const textRoot = localName(textEl) === "tspan" ? (textEl.closest("text") ?? textEl) : textEl;

	// Check if textRoot is wrapped in a dedicated single-text <g>
	// (e.g. <g id="chip"><rect/><text/></g> or <g data-a1-card="chip"><rect/><text/></g>)
	let curr: Element | null = textRoot.parentElement;
	const svg = textRoot.closest("svg");
	let dedicatedChip: Element | null = null;

	while (curr && curr !== svg) {
		if (localName(curr) === "g") {
			if (countTexts(curr) === 1) {
				// This group contains ONLY this text: it is a dedicated small box/chip (小框)
				dedicatedChip = curr;
			} else {
				// As soon as an ancestor group contains > 1 text, it is a multi-text container (大框).
				// We stop searching upwards so we never delete the outer container/card!
				break;
			}
		}
		curr = curr.parentElement;
	}

	if (dedicatedChip) {
		return [dedicatedChip];
	}

	// If no dedicated single-text group: this text is just a line inside a larger card or canvas.
	// Strictly only delete the text node itself!
	return [textRoot];
}

export function asText(node: Element): SVGTextElement | null {
	if (!node) return null;
	const el = node.closest("text, tspan") ?? (isTextNode(node) ? node : null);
	if (!el) return null;
	const text = localName(el) === "text" ? el : el.closest("text");
	if (text && localName(text) === "text") return text as SVGTextElement;
	return null;
}

function pickClosestText(texts: SVGTextElement[], clientX?: number, clientY?: number): SVGTextElement {
	if (texts.length === 0) throw new Error("pickClosestText called with empty array");
	if (clientX == null || clientY == null) {
		return texts[0];
	}
	let best = texts[0];
	let bestDist = Infinity;
	for (const t of texts) {
		let cx = num(t.getAttribute("x")) ?? 0;
		let cy = num(t.getAttribute("y")) ?? 0;
		if (typeof t.getBoundingClientRect === "function") {
			const r = t.getBoundingClientRect();
			if (r.width > 0 || r.height > 0) {
				cx = r.left + r.width / 2;
				cy = r.top + r.height / 2;
			}
		}
		const d = Math.hypot(cx - clientX, cy - clientY);
		if (d < bestDist) {
			bestDist = d;
			best = t;
		}
	}
	return best;
}

/**
 * Resolves the appropriate <text> element from any SVG element (rect, path, g, text, etc.).
 * If clientX and clientY are provided, picks the text element closest to the pointer.
 */
export function findTextInCard(start: Element, clientX?: number, clientY?: number): SVGTextElement | null {
	if (!start) return null;
	const direct = asText(start);
	if (direct) return direct;

	const hasInstanceOf = "instanceOf" in start && typeof (start as { instanceOf?: (cls: unknown) => boolean }).instanceOf === "function";
	const isSvg = (hasInstanceOf ? (start as { instanceOf: (cls: unknown) => boolean }).instanceOf(SVGSVGElement) : false) || localName(start) === "svg";
	const svg = isSvg ? start : (start.closest("svg") ?? start.querySelector("svg"));
	if (!svg) return null;

	// 1. If start has text descendants
	const descendants = Array.from(start.querySelectorAll("text")).filter((t) => asText(t) !== null) as SVGTextElement[];
	if (descendants.length === 1) return descendants[0];
	if (descendants.length > 1) {
		return pickClosestText(descendants, clientX, clientY);
	}

	// 2. Check parent and ancestor <g> elements up to <svg>
	let curr: Element | null = start.parentElement;
	while (curr && curr !== svg) {
		const name = localName(curr);
		if (name === "g" || curr.hasAttribute("data-a1-card")) {
			const texts = Array.from(curr.querySelectorAll("text")).filter((t) => asText(t) !== null) as SVGTextElement[];
			if (texts.length === 1) return texts[0];
			if (texts.length > 1) {
				return pickClosestText(texts, clientX, clientY);
			}
		}
		curr = curr.parentElement;
	}

	// 3. If start is a <rect>, try to find text whose coordinates fall inside or near this rect
	const name = localName(start);
	if (name === "rect") {
		const rx = num(start.getAttribute("x")) ?? 0;
		const ry = num(start.getAttribute("y")) ?? 0;
		const rw = num(start.getAttribute("width"));
		const rh = num(start.getAttribute("height"));
		if (rw != null && rh != null && rw > 0 && rh > 0) {
			const allTexts = Array.from(svg.querySelectorAll("text")).filter((t) => asText(t) !== null) as SVGTextElement[];
			const insideTexts = allTexts.filter((t) => {
				const pt = getCoords(t);
				if (!pt) return false;
				return pt.x >= rx - 8 && pt.x <= rx + rw + 8 && pt.y >= ry - 8 && pt.y <= ry + rh + 8;
			});
			if (insideTexts.length === 1) return insideTexts[0];
			if (insideTexts.length > 1) {
				return pickClosestText(insideTexts, clientX, clientY);
			}
		}
	}

	// 4. Fallback: all texts in SVG
	const allSvgTexts = Array.from(svg.querySelectorAll("text")).filter((t) => asText(t) !== null) as SVGTextElement[];
	if (allSvgTexts.length === 1) return allSvgTexts[0];
	if (allSvgTexts.length > 1 && clientX != null && clientY != null) {
		return pickClosestText(allSvgTexts, clientX, clientY);
	}

	return allSvgTexts[0] ?? null;
}

export function resolveHit(start: Element): TextHit | null {
	let textEl: Element | null = start;
	if (!isTextNode(textEl)) {
		textEl = asText(start) ?? findTextInCard(start);
	}
	if (!textEl || !isTextNode(textEl)) return null;
	// Editing a tspan writes that tspan; the card is still the surrounding group.
	const card = findCard(textEl.localName === "tspan" || localName(textEl) === "tspan"
		? (textEl.closest("text") ?? textEl)
		: textEl);
	return { textEl, card, owned: collectOwned(card, textEl) };
}

export function readText(textEl: Element): string {
	return (textEl.textContent ?? "").replace(/\u00a0/g, " ");
}

export function writeText(textEl: Element, value: string): void {
	// Keep a single text child so we do not duplicate tspans on every save.
	const name = localName(textEl);
	if (name === "text") {
		const tspans = Array.from(textEl.children).filter((c) => localName(c) === "tspan");
		if (tspans.length === 1 && textEl.childNodes.length === 1) {
			tspans[0].textContent = value;
			return;
		}
		if (tspans.length > 1) {
			// Multi-line: put the whole string on the first tspan and drop the rest.
			tspans[0].textContent = value;
			for (let i = 1; i < tspans.length; i++) tspans[i].remove();
			return;
		}
	}
	textEl.textContent = value;
}

export interface CommitResult {
	action: "update" | "delete";
	removed: Element[];
}

/**
 * Empty / whitespace-only commits remove the whole card.
 * Non-empty commits replace the text node's string.
 */
export function commitText(hit: TextHit, raw: string): CommitResult {
	const value = raw.replace(/\u00a0/g, " ").trim();
	if (value.length === 0) {
		for (const el of hit.owned) {
			el.remove();
		}
		return { action: "delete", removed: hit.owned };
	}
	writeText(hit.textEl, value);
	adaptBackgroundToText(hit.textEl, value);
	return { action: "update", removed: [] };
}

let cloneSeq = 0;

/** Deep-clone a card, offset it, and return the clone (not yet given unique ids). */
export function cloneCard(card: Element, dx: number, dy: number): Element {
	const clone = card.cloneNode(true) as Element;
	cloneSeq += 1;
	const stamp = `a1c${cloneSeq}`;
	nudge(clone, dx, dy);
	rewriteIds(card, clone, stamp);
	return clone;
}

function num(raw: string | null): number | null {
	if (raw == null || raw.trim() === "") return null;
	const n = parseFloat(raw);
	return Number.isFinite(n) ? n : null;
}

/** One translate, merged with a previous translate() so drags do not stack. */
export function nudge(el: Element, dx: number, dy: number): void {
	const name = localName(el);
	if (name === "g" || name === "svg" || name === "use" || name === "path" || name === "polygon" || name === "polyline" || el.hasAttribute("transform")) {
		const prev = el.getAttribute("transform") ?? "";
		const transMatch = prev.match(/translate\(\s*([-\d.eE+]+)(?:[\s,]+([-\d.eE+]+))?\s*\)(?=\s*(?:scale\([^)]*\)|\s*$))/);
		if (transMatch && transMatch.index != null) {
			const x = parseFloat(transMatch[1]) + dx;
			const y = (transMatch[2] != null ? parseFloat(transMatch[2]) : 0) + dy;
			const newTrans = `translate(${trimNum(x)} ${trimNum(y)})`;
			el.setAttribute("transform", prev.slice(0, transMatch.index) + newTrans + prev.slice(transMatch.index + transMatch[0].length));
			return;
		}
		const m = prev.match(/translate\(\s*([-\d.eE+]+)(?:[\s,]+([-\d.eE+]+))?\s*\)\s*$/);
		if (m) {
			const x = parseFloat(m[1]) + dx;
			const y = (m[2] != null ? parseFloat(m[2]) : 0) + dy;
			el.setAttribute("transform", prev.slice(0, m.index) + `translate(${trimNum(x)} ${trimNum(y)})`);
		} else {
			el.setAttribute("transform", `${prev} translate(${trimNum(dx)} ${trimNum(dy)})`.trim());
		}
		return;
	}
	shiftAttr(el, "x", dx);
	shiftAttr(el, "y", dy);
	shiftAttr(el, "cx", dx);
	shiftAttr(el, "cy", dy);
	shiftAttr(el, "x1", dx);
	shiftAttr(el, "y1", dy);
	shiftAttr(el, "x2", dx);
	shiftAttr(el, "y2", dy);
	if (name === "text") {
		for (const tspan of Array.from(el.querySelectorAll("tspan"))) {
			shiftAttr(tspan, "x", dx);
			shiftAttr(tspan, "y", dy);
		}
	}
}

export function getElementCenter(el: Element, svg: Element): { x: number; y: number } {
	if (typeof (el as any).getBBox === "function") {
		try {
			const bb = (el as any).getBBox();
			if (bb && (bb.width > 0 || bb.height > 0)) {
				return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
			}
		} catch {}
	}
	const m = measureBox(el, svg);
	if (m) {
		return { x: (m.left + m.right) / 2, y: (m.top + m.bottom) / 2 };
	}
	const x = num(el.getAttribute("x")) ?? num(el.getAttribute("cx")) ?? 0;
	const y = num(el.getAttribute("y")) ?? num(el.getAttribute("cy")) ?? 0;
	return { x, y };
}

/**
 * Scale an element uniformly around its center.
 * Preserves existing translation and other transform components.
 * Returns the resulting scale factor.
 */
export function scaleCard(el: Element, svg: Element, factor: number): { scale: number } | null {
	const prev = el.getAttribute("transform") ?? "";

	let curScale = 1;
	let curTx = 0;
	let curTy = 0;

	// Match current scale
	const scaleMatch = prev.match(/scale\(\s*([-\d.eE+]+)(?:[\s,]+([-\d.eE+]+))?\s*\)/);
	if (scaleMatch) {
		curScale = parseFloat(scaleMatch[1]) || 1;
	}

	// Match current translate
	const transMatch = prev.match(/translate\(\s*([-\d.eE+]+)(?:[\s,]+([-\d.eE+]+))?\s*\)/);
	if (transMatch) {
		curTx = parseFloat(transMatch[1]) || 0;
		curTy = transMatch[2] != null ? parseFloat(transMatch[2]) : 0;
	}

	const rawNewScale = curScale * factor;
	// Clamp scale between 0.15 (15%) and 6.0 (600%)
	const newScale = Math.min(6.0, Math.max(0.15, rawNewScale));
	const actualFactor = newScale / curScale;
	if (Math.abs(actualFactor - 1) < 0.0001) {
		return { scale: curScale };
	}

	// Center of element in parent coordinates
	const center = getElementCenter(el, svg);

	// Invariance formula: C' = actualFactor * t + (1 - actualFactor) * C
	const newTx = actualFactor * curTx + (1 - actualFactor) * center.x;
	const newTy = actualFactor * curTy + (1 - actualFactor) * center.y;

	// Strip out old translate and scale to cleanly reassemble
	const otherTransforms = prev
		.replace(/translate\(\s*[^)]+\)/g, "")
		.replace(/scale\(\s*[^)]+\)/g, "")
		.trim();

	const newTransform = `translate(${trimNum(newTx)} ${trimNum(newTy)}) scale(${trimNum(newScale)})${otherTransforms ? " " + otherTransforms : ""}`;
	el.setAttribute("transform", newTransform.trim());

	return { scale: newScale };
}

function shiftAttr(el: Element, attr: string, delta: number): void {
	if (delta === 0 || !el.hasAttribute(attr)) return;
	const n = num(el.getAttribute(attr));
	if (n == null) return;
	el.setAttribute(attr, trimNum(n + delta));
}

function trimNum(n: number): string {
	const r = Math.round(n * 100) / 100;
	return String(r);
}

function rewriteIds(source: Element, clone: Element, stamp: string): void {
	const map = new Map<string, string>();
	const walk = (el: Element) => {
		const id = el.getAttribute("id");
		if (id) {
			const next = `${id}-${stamp}`;
			map.set(id, next);
			el.setAttribute("id", next);
		}
		for (const child of Array.from(el.children)) walk(child);
	};
	walk(clone);
	if (map.size === 0) return;
	const retarget = (el: Element) => {
		for (const attr of ["href", "xlink:href", "fill", "stroke", "filter", "clip-path", "mask"]) {
			const v = el.getAttribute(attr);
			if (!v) continue;
			el.setAttribute(attr, v.replace(/url\(#([^)]+)\)|#([A-Za-z_][\w:.-]*)/g, (m: string, urlId?: string, hashId?: string) => {
				const id = urlId || hashId;
				if (!id) return m;
				const next = map.get(id);
				if (!next) return m;
				return urlId ? `url(#${next})` : `#${next}`;
			}));
		}
		for (const child of Array.from(el.children)) retarget(child);
	};
	retarget(clone);
	void source;
}

function escapeText(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
	return escapeText(s).replace(/"/g, "&quot;");
}

/** Serialize an element. Avoids XMLSerializer so tests and older hosts agree. */
export function serializeSvg(el: Element): string {
	if (el.getAttribute("data-a1-align") === "1") return "";
	const name = el.localName || el.tagName;
	const attrs: string[] = [];
	for (let i = 0; i < el.attributes.length; i++) {
		const a = el.attributes[i];
		if (a.name === "data-a1-svg-path" || a.name === "data-a1-pad") continue;
		if (a.name === "class") {
			const cleaned = a.value
				.split(/\s+/)
				.filter((c) => c && c !== "a1-svg-hover-text")
				.join(" ");
			if (!cleaned) continue;
			attrs.push(`class="${escapeAttr(cleaned)}"`);
			continue;
		}
		attrs.push(`${a.name}="${escapeAttr(a.value)}"`);
	}
	const open = attrs.length ? `<${name} ${attrs.join(" ")}>` : `<${name}>`;
	let inner = "";
	for (const node of Array.from(el.childNodes)) {
		if (node.nodeType === 1) inner += serializeSvg(node as Element);
		else if (node.nodeType === 3) inner += escapeText(node.textContent ?? "");
	}
	return `${open}${inner}</${name}>`;
}

/**
 * Estimates text display width when rendered with a given fontSize.
 * Handles CJK (1.0em), Latin letters and numbers (~0.58em), spaces (0.32em), and narrow/wide symbols.
 */
export function estimateStringWidth(str: string, fontSize: number): number {
	let total = 0;
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (
			code > 0x2e80 ||
			(code >= 0x2000 && code <= 0x206f) ||
			(code >= 0x3000 && code <= 0x303f) ||
			(code >= 0xff00 && code <= 0xffef)
		) {
			// CJK characters, full-width punctuation, ideographic symbols
			total += fontSize * 1.0;
		} else if (code === 32) {
			// Space
			total += fontSize * 0.32;
		} else if (
			str[i] === "i" ||
			str[i] === "l" ||
			str[i] === "I" ||
			str[i] === "j" ||
			str[i] === "'" ||
			str[i] === "!" ||
			str[i] === "|" ||
			str[i] === "." ||
			str[i] === ":" ||
			str[i] === ";"
		) {
			// Narrow characters
			total += fontSize * 0.28;
		} else if (
			str[i] === "m" ||
			str[i] === "w" ||
			str[i] === "M" ||
			str[i] === "W" ||
			str[i] === "@" ||
			str[i] === "%"
		) {
			// Wide Latin letters and symbols
			total += fontSize * 0.85;
		} else if (
			(code >= 48 && code <= 57) ||
			(code >= 65 && code <= 90) ||
			(code >= 97 && code <= 122)
		) {
			// Normal Latin letters and digits
			total += fontSize * 0.58;
		} else {
			// General symbols (+, -, *, /, (), [], etc.)
			total += fontSize * 0.45;
		}
	}
	return total;
}

/**
 * Measures the pixel width of an SVG text element.
 * Prioritizes native browser SVG text metrics (getComputedTextLength, getBBox),
 * falling back to character-type heuristics.
 */
export function measureTextWidth(textEl: SVGTextElement, textContent?: string): number {
	const content = textContent !== undefined ? textContent : (textEl.textContent ?? "");
	if (!content) return 0;

	if (typeof window !== "undefined" && typeof textEl.getComputedTextLength === "function") {
		try {
			const original = textEl.textContent;
			if (textContent !== undefined && textContent !== original) {
				textEl.textContent = textContent;
				const len = textEl.getComputedTextLength();
				textEl.textContent = original;
				if (len && len > 0) return len;
			} else {
				const len = textEl.getComputedTextLength();
				if (len && len > 0) return len;
			}
		} catch {}
	}

	if (typeof window !== "undefined" && typeof textEl.getBBox === "function") {
		try {
			const bb = textEl.getBBox();
			if (bb && bb.width > 0) return bb.width;
		} catch {}
	}

	let fontSize = 14;
	const fsAttr = textEl.getAttribute("font-size");
	if (fsAttr) {
		const parsed = parseFloat(fsAttr);
		if (Number.isFinite(parsed) && parsed > 0) fontSize = parsed;
	} else if (typeof window !== "undefined" && typeof getComputedStyle === "function") {
		try {
			const cs = getComputedStyle(textEl);
			const parsed = parseFloat(cs.fontSize);
			if (Number.isFinite(parsed) && parsed > 0) fontSize = parsed;
		} catch {}
	}

	return estimateStringWidth(content, fontSize);
}

/**
 * Locates the background <rect> belonging to this specific text element (chip / badge / pill / box).
 * Avoids canvas backgrounds or outer cards containing multiple texts.
 */
export function findBackgroundRectForText(textEl: Element): Element | null {
	if (!textEl) return null;
	const svg = textEl.closest("svg");
	if (!svg) return null;

	const parent = textEl.parentElement;
	if (parent && parent !== svg) {
		// Case 1: Parent is a dedicated group containing only this text (e.g. <g><rect/><text/></g>)
		if (localName(parent) === "g") {
			const textsInParent = Array.from(parent.querySelectorAll("text"));
			if (textsInParent.length === 1 && textsInParent[0] === textEl) {
				const rects = Array.from(parent.children).filter((c) => localName(c) === "rect");
				if (rects.length === 1 && isCardSizedRect(rects[0], svg)) {
					return rects[0];
				}
				if (rects.length > 1) {
					const valid = rects.filter((r) => isCardSizedRect(r, svg));
					if (valid.length === 1) return valid[0];
				}
			}
		}

		// Case 2: Adjacent badge rect in a multi-item container
		const badge = findAdjacentBadgeRect(textEl);
		if (badge) return badge;
	}

	// Case 3: Search ancestors up to svg for a dedicated single-text container
	let curr: Element | null = parent;
	while (curr && curr !== svg) {
		if (localName(curr) === "g") {
			const texts = Array.from(curr.querySelectorAll("text"));
			if (texts.length === 1 && texts[0] === textEl) {
				const rect = curr.querySelector(":scope > rect");
				if (rect && isCardSizedRect(rect, svg)) {
					return rect;
				}
			}
		}
		curr = curr.parentElement;
	}

	return null;
}

/**
 * Shifts subsequent sibling chips to the right when a chip's width expands,
 * maintaining horizontal flow and preventing overlap.
 */
function shiftSubsequentSiblingChips(chipGroup: Element, deltaW: number): void {
	if (Math.abs(deltaW) < 0.5) return;
	const parent = chipGroup.parentElement;
	if (!parent) return;

	const chipCoords = getCoords(chipGroup);
	if (!chipCoords) return;

	const siblings = Array.from(parent.children).filter((c) => {
		if (c === chipGroup || localName(c) !== "g") return false;
		return countTexts(c) === 1 && c.querySelector("rect") !== null;
	});

	for (const sib of siblings) {
		const sibCoords = getCoords(sib);
		if (!sibCoords) return;
		// Same row (within 10px Y) and positioned to the right
		if (Math.abs(sibCoords.y - chipCoords.y) <= 10 && sibCoords.x > chipCoords.x) {
			nudge(sib, deltaW, 0);
		}
	}
}

/**
 * Intelligently adapts the background rect's width to fit the given text content.
 * Keeps centered text centered (text-anchor="middle") and adjusts rect width seamlessly.
 * Does NOT run smartAutoLayout (only adapts the background of the edited text).
 */
export function adaptBackgroundToText(textEl: Element, newText?: string): boolean {
	const text = asText(textEl);
	if (!text) return false;

	const content = newText !== undefined ? newText : (text.textContent ?? "");
	if (!content.trim()) return false;

	const bgRect = findBackgroundRectForText(text);
	if (!bgRect) return false;

	const curRectW = num(bgRect.getAttribute("width"));
	if (curRectW == null || curRectW <= 0) return false;

	const textW = measureTextWidth(text, content);
	if (textW <= 0) return false;

	// Calculate appropriate horizontal padding:
	// 1. If previously recorded on the rect, use the established baseline padding.
	// 2. Standard 28px pills have 18px padding (9px each side); 20px badges have 12px padding.
	// 3. Otherwise compute proportionally from font-size.
	let padH = 18;
	const storedPad = num(bgRect.getAttribute("data-a1-pad"));
	if (storedPad != null && storedPad >= 6 && storedPad <= 36) {
		padH = storedPad;
	} else {
		const rectH = num(bgRect.getAttribute("height")) || 28;
		if (Math.abs(rectH - 28) <= 2) {
			padH = 18;
		} else if (Math.abs(rectH - 20) <= 2) {
			padH = 12;
		} else {
			const fsAttr = text.getAttribute("font-size");
			const fs = fsAttr ? parseFloat(fsAttr) : 14;
			const validFs = Number.isFinite(fs) && fs > 0 ? fs : 14;
			padH = Math.round(Math.max(12, Math.min(26, validFs * 1.45)) * 10) / 10;
		}
		bgRect.setAttribute("data-a1-pad", trimNum(padH));
	}

	const rectH = num(bgRect.getAttribute("height")) || 24;
	const minW = Math.max(rectH, 26);
	const newRectW = Math.max(minW, Math.round((textW + padH) * 10) / 10);
	const deltaW = newRectW - curRectW;
	if (Math.abs(deltaW) < 0.5) return false;

	bgRect.setAttribute("width", trimNum(newRectW));

	// Alignment adjustment
	const anchor = (text.getAttribute("text-anchor") || "").toLowerCase();
	const rectX = num(bgRect.getAttribute("x")) ?? 0;

	if (anchor === "middle") {
		const newCenterX = Math.round((rectX + newRectW / 2) * 10) / 10;
		text.setAttribute("x", trimNum(newCenterX));
		for (const tspan of Array.from(text.querySelectorAll("tspan"))) {
			tspan.setAttribute("x", trimNum(newCenterX));
		}
	} else if (anchor === "end") {
		const newEndX = Math.round((rectX + newRectW - padH / 2) * 10) / 10;
		text.setAttribute("x", trimNum(newEndX));
		for (const tspan of Array.from(text.querySelectorAll("tspan"))) {
			tspan.setAttribute("x", trimNum(newEndX));
		}
	} else {
		// Left-aligned: text stays at rectX + padH / 2
		const curX = num(text.getAttribute("x")) ?? 0;
		if (curX < rectX) {
			bgRect.setAttribute("x", trimNum(curX - padH / 2));
		}
	}

	// If this chip is wrapped in a dedicated group, shift subsequent chips in the same row
	const chipGroup = text.parentElement;
	if (chipGroup && localName(chipGroup) === "g" && countTexts(chipGroup) === 1) {
		shiftSubsequentSiblingChips(chipGroup, deltaW);
	}

	return true;
}

/**
 * Scans all <text> elements in the SVG and auto-adapts their background rects if text overflows.
 */
export function adaptAllTextBackgrounds(svg: Element): boolean {
	let changed = false;
	const texts = Array.from(svg.querySelectorAll("text"));
	for (const t of texts) {
		if (adaptBackgroundToText(t)) {
			changed = true;
		}
	}
	return changed;
}

export function resetCloneSeq(n = 0): void {
	cloneSeq = n;
}

/** Insert a clone as the immediate next sibling so it stays at the source's depth. */
export function insertCloneSibling(source: Element, clone: Element): void {
	const parent = source.parentElement;
	if (!parent) return;
	const next = source.nextSibling;
	if (next) parent.insertBefore(clone, next);
	else parent.appendChild(clone);
}

export interface AlignGuide {
	axis: "x" | "y";
	value: number;
}

export interface SnapResult {
	dx: number;
	dy: number;
	guides: AlignGuide[];
}

export interface BoxBounds {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/**
 * Measure element bounds in SVG root coordinate system.
 * Works across nested groups, translates, viewbox scale, rects, and texts.
 */
export function measureBox(el: Element, svg: Element): BoxBounds | null {
	if (typeof SVGSVGElement !== "undefined" && svg instanceof SVGSVGElement && typeof el.getBoundingClientRect === "function") {
		try {
			const ctm = svg.getScreenCTM();
			if (ctm) {
				const inv = ctm.inverse();
				const r = el.getBoundingClientRect();
				if (r && (r.width > 0 || r.height > 0)) {
					const p1 = { x: inv.a * r.left + inv.c * r.top + inv.e, y: inv.b * r.left + inv.d * r.top + inv.f };
					const p2 = { x: inv.a * r.right + inv.c * r.bottom + inv.e, y: inv.b * r.right + inv.d * r.bottom + inv.f };
					const left = Math.min(p1.x, p2.x);
					const right = Math.max(p1.x, p2.x);
					const top = Math.min(p1.y, p2.y);
					const bottom = Math.max(p1.y, p2.y);
					if (Number.isFinite(left) && Number.isFinite(top) && right > left && bottom > top) {
						return { left, right, top, bottom };
					}
				}
			}
		} catch {}
	}

	const rects = localName(el) === "rect" ? [el] : Array.from(el.querySelectorAll("rect"));
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const r of rects) {
		const x = num(r.getAttribute("x")) ?? 0;
		const y = num(r.getAttribute("y")) ?? 0;
		const w = num(r.getAttribute("width"));
		const h = num(r.getAttribute("height"));
		if (w == null || h == null || w <= 0 || h <= 0) continue;
		const origin = ancestorTranslate(r, svg);
		left = Math.min(left, x + origin.x);
		top = Math.min(top, y + origin.y);
		right = Math.max(right, x + origin.x + w);
		bottom = Math.max(bottom, y + origin.y + h);
	}
	if (!Number.isFinite(left)) {
		const texts = localName(el) === "text" ? [el] : Array.from(el.querySelectorAll("text"));
		for (const t of texts) {
			const coords = getCoords(t);
			if (!coords) continue;
			const origin = ancestorTranslate(t, svg);
			const tx = coords.x + origin.x;
			const ty = coords.y + origin.y;
			// SVG y is the baseline, not the bottom of the glyphs.
			const fontSize = num(t.getAttribute("font-size")) ?? 16;
			const descent = fontSize * 0.25;
			const approxW = Math.max(20, (t.textContent?.length || 5) * fontSize * 0.6);
			left = Math.min(left, tx);
			top = Math.min(top, ty - fontSize);
			right = Math.max(right, tx + approxW);
			bottom = Math.max(bottom, ty + descent);
		}
	}
	if (!Number.isFinite(left)) return null;
	return { left, right, top, bottom };
}

function ancestorTranslate(node: Element, stopAt: Element): { x: number; y: number } {
	let x = 0;
	let y = 0;
	let cur: Element | null = node;
	while (cur && cur !== stopAt) {
		const tr = cur.getAttribute("transform") ?? "";
		const m = tr.match(/translate\(\s*([-\d.eE+]+)(?:[\s,]+([-\d.eE+]+))?\s*\)/);
		if (m) {
			x += parseFloat(m[1]);
			y += m[2] != null ? parseFloat(m[2]) : 0;
		}
		cur = cur.parentElement;
	}
	return { x, y };
}

export function isSmallBox(box: BoxBounds, el?: Element): boolean {
	const w = box.right - box.left;
	const h = box.bottom - box.top;
	if (el) {
		if (el.classList?.contains("a1-svg-chip") || el.getAttribute("data-a1-card") === "chip") return true;
		if (el.hasAttribute("stroke-dasharray")) return true;
	}
	// Row items, badges, chips, dashed boxes have compact height (<= 70) and reasonable width (<= 450)
	if (h <= 70 && w <= 450 && (w > 2 || h > 2)) return true;
	// Small in both dimensions
	if (w <= 240 && h <= 85) return true;
	return false;
}

export function collectAlignTargets(svg: Element, moving: Element): Element[] {
	const targets: Element[] = [];
	const seenBoxes = new Set<string>();

	const all = Array.from(svg.querySelectorAll("g, rect, text")).filter((el) => {
		if (el === moving) return false;
		if (moving.contains(el)) return false;
		if (el.hasAttribute("data-a1-align") || el.closest("[data-a1-align]")) return false;
		if (el.getAttribute("display") === "none") return false;

		const name = localName(el);
		if (name === "rect") {
			if (!isCardSizedRect(el, svg)) return false;
			const w = num(el.getAttribute("width")) ?? 0;
			const h = num(el.getAttribute("height")) ?? 0;
			if (w <= 1 && h <= 1) return false;
			return true;
		}
		if (name === "text") {
			const str = (el.textContent || "").trim();
			if (str.length === 0) return false;
			// If text is inside a dedicated single-text chip group that has a rect,
			// the chip group represents the visual box, so skip duplicate inner text
			const parentG = el.closest("g");
			if (parentG && parentG !== svg && countTexts(parentG) === 1 && parentG.querySelector("rect")) {
				return false;
			}
			return true;
		}
		if (name === "g") {
			if (el.contains(moving)) return false;
			return countTexts(el) >= 1 || el.querySelector("rect") !== null;
		}
		return false;
	});

	for (const cand of all) {
		const box = measureBox(cand, svg);
		if (!box) continue;
		if (box.right <= box.left || box.bottom <= box.top) continue;
		const key = `${Math.round(box.left)}|${Math.round(box.top)}|${Math.round(box.right)}|${Math.round(box.bottom)}`;
		if (seenBoxes.has(key)) continue;
		seenBoxes.add(key);
		targets.push(cand);
	}

	return targets;
}

/**
 * Magnetic edge/center snapping.
 * - Moving small box: locks to other small boxes within ~5mm (priority 0); locks to large cards within ~2mm (priority 1).
 * - Moving large card: locks to other large cards within ~2mm.
 * - Same-edge alignment (Left-to-Left, Right-to-Right, Top-to-Top, Bottom-to-Bottom) takes strict precedence over Center.
 * - Deduplication skips self, ancestors, descendants, and duplicate boxes.
 */
export function snapDelta(
	moving: Element,
	svg: Element,
	opts: { pxPerMm?: number } = {},
): SnapResult {
	const pxPerMm = opts.pxPerMm && opts.pxPerMm > 0 ? opts.pxPerMm : 3.78;
	const self = measureBox(moving, svg);
	if (!self) return { dx: 0, dy: 0, guides: [] };

	const movingIsSmall = isSmallBox(self, moving, svg);
	const targetEls = collectAlignTargets(svg, moving);

	interface PeerItem {
		el: Element;
		box: BoxBounds;
		isSmall: boolean;
	}

	const peers: PeerItem[] = [];
	for (const t of targetEls) {
		const box = measureBox(t, svg);
		if (!box) continue;
		peers.push({ el: t, box, isSmall: isSmallBox(box, t, svg) });
	}

	const xSnap = bestAxisSnap(self, peers, "x", pxPerMm, movingIsSmall);
	const ySnap = bestAxisSnap(self, peers, "y", pxPerMm, movingIsSmall);

	const guides: AlignGuide[] = [];
	if (xSnap) guides.push({ axis: "x", value: xSnap.guide });
	if (ySnap) guides.push({ axis: "y", value: ySnap.guide });

	return {
		dx: xSnap?.delta ?? 0,
		dy: ySnap?.delta ?? 0,
		guides,
	};
}

function bestAxisSnap(
	self: BoxBounds,
	peers: { el: Element; box: BoxBounds; isSmall: boolean }[],
	axis: "x" | "y",
	pxPerMm: number,
	movingIsSmall: boolean,
): { delta: number; guide: number } | null {
	let best: {
		abs: number;
		delta: number;
		guide: number;
		hierarchyRank: number;
		typeRank: number;
	} | null = null;

	const selfCenter = axis === "x" ? (self.left + self.right) / 2 : (self.top + self.bottom) / 2;

	for (const peer of peers) {
		let thresholdMm = 2;
		let hierarchyRank = 1;

		if (movingIsSmall) {
			if (peer.isSmall) {
				thresholdMm = 5; // 5mm priority for small box to small box
				hierarchyRank = 0;
			} else {
				thresholdMm = 2; // 2mm for small box to big card
				hierarchyRank = 1;
			}
		} else {
			if (peer.isSmall) {
				// Big card does not snap to tiny child chips inside other cards
				continue;
			}
			thresholdMm = 2; // 2mm for big card to big card
			hierarchyRank = 0;
		}

		const thresholdPx = thresholdMm * pxPerMm;
		const peerCenter = axis === "x" ? (peer.box.left + peer.box.right) / 2 : (peer.box.top + peer.box.bottom) / 2;

		interface AlignPair {
			sPt: number;
			pPt: number;
			typeRank: number;
		}

		// Prioritize same-edge alignment (Left-to-Left, Right-to-Right, Top-to-Top, Bottom-to-Bottom)
		// over center alignment and abutting alignment!
		const pairs: AlignPair[] = axis === "x" ? [
			{ sPt: self.left, pPt: peer.box.left, typeRank: 0 },    // Left to Left (HIGHEST PRIORITY)
			{ sPt: self.right, pPt: peer.box.right, typeRank: 0 },  // Right to Right
			{ sPt: selfCenter, pPt: peerCenter, typeRank: 1 },      // Center to Center
			{ sPt: self.left, pPt: peer.box.right, typeRank: 2 },   // Left to Right (abut)
			{ sPt: self.right, pPt: peer.box.left, typeRank: 2 },   // Right to Left (abut)
		] : [
			{ sPt: self.top, pPt: peer.box.top, typeRank: 0 },       // Top to Top (HIGHEST PRIORITY)
			{ sPt: self.bottom, pPt: peer.box.bottom, typeRank: 0 }, // Bottom to Bottom
			{ sPt: selfCenter, pPt: peerCenter, typeRank: 1 },       // Center to Center
			{ sPt: self.top, pPt: peer.box.bottom, typeRank: 2 },    // Top to Bottom (abut)
			{ sPt: self.bottom, pPt: peer.box.top, typeRank: 2 },    // Bottom to Top (abut)
		];

		for (const { sPt, pPt, typeRank } of pairs) {
			const delta = pPt - sPt;
			const abs = Math.abs(delta);
			if (abs <= thresholdPx + 1e-4) {
				if (
					!best ||
					hierarchyRank < best.hierarchyRank ||
					(hierarchyRank === best.hierarchyRank && typeRank < best.typeRank) ||
					(hierarchyRank === best.hierarchyRank && typeRank === best.typeRank && abs < best.abs - 1e-4)
				) {
					best = { abs, delta, guide: pPt, hierarchyRank, typeRank };
				}
			}
		}
	}

	return best ? { delta: best.delta, guide: best.guide } : null;
}

export interface SmartLayoutResult {
	changed: boolean;
	count: number;
}

interface LayoutItem {
	el: Element;
	box: BoxBounds;
}

/**
 * Detects and aligns horizontal rows of sibling cards/chips:
 * - Aligns their vertical position (Y) to the row's dominant/baseline Y.
 * - Aligns their horizontal spacing (X) preserving the established/median gap (e.g. 8px).
 */
export function layoutHorizontalRows(svg: Element): SmartLayoutResult {
	const hidden = (el: Element) => el.getAttribute("display") === "none" || !!el.closest("[data-a1-align]");
	const vbAttr = (svg.getAttribute("viewBox") || svg.getAttribute("viewbox") || "").trim().split(/[\s,]+/);
	const svgW = vbAttr.length === 4 ? parseFloat(vbAttr[2]) : (num(svg.getAttribute("width")) || 800);
	const svgH = vbAttr.length === 4 ? parseFloat(vbAttr[3]) : (num(svg.getAttribute("height")) || 600);

	const isCanvas = (box: BoxBounds) => {
		const w = box.right - box.left;
		const h = box.bottom - box.top;
		return w >= svgW * 0.92 && h >= svgH * 0.92;
	};

	// 1. Gather all potential card elements
	const cardGroups = Array.from(svg.querySelectorAll("g")).filter((g) => {
		if (hidden(g)) return false;
		return g.querySelector("text") !== null && g.querySelector("rect, circle, ellipse, path") !== null;
	});
	const atomicGroups = cardGroups.filter((g) => !cardGroups.some((other) => other !== g && g.contains(other)));

	interface RowCandidate {
		el: Element;
		box: BoxBounds;
		parent: Element;
	}

	const candidates: RowCandidate[] = [];
	for (const g of atomicGroups) {
		const box = measureBox(g, svg);
		if (!box || isCanvas(box)) continue;
		if (g.parentElement) {
			candidates.push({ el: g, box, parent: g.parentElement });
		}
	}

	for (const r of Array.from(svg.querySelectorAll("rect"))) {
		if (hidden(r)) continue;
		if (atomicGroups.some((g) => g.contains(r))) continue;
		const w = num(r.getAttribute("width")) ?? 0;
		const h = num(r.getAttribute("height")) ?? 0;
		if (w < 20 || h < 16) continue;
		const box = measureBox(r, svg);
		if (!box || isCanvas(box)) continue;
		if (r.parentElement) {
			candidates.push({ el: r, box, parent: r.parentElement });
		}
	}

	// 2. Group candidates by parent container
	const parentMap = new Map<Element, RowCandidate[]>();
	for (const cand of candidates) {
		let list = parentMap.get(cand.parent);
		if (!list) {
			list = [];
			parentMap.set(cand.parent, list);
		}
		list.push(cand);
	}

	let totalChanged = false;
	let totalCount = 0;

	// Collect global gaps across all rows to provide an intelligent fallback
	const allGaps: number[] = [];
	for (const [, list] of parentMap.entries()) {
		if (list.length < 2) continue;
		const sorted = [...list].sort((a, b) => a.box.left - b.box.left);
		for (let i = 0; i < sorted.length - 1; i++) {
			const g = sorted[i + 1].box.left - sorted[i].box.right;
			if (g >= 4 && g <= 48) allGaps.push(g);
		}
	}
	const globalMedianGap = allGaps.length > 0 ? median(allGaps) : 8;

	// 3. For each parent, find horizontal rows of items
	for (const [parent, list] of parentMap.entries()) {
		const parentBox = measureBox(parent, svg);
		const parentW = parentBox ? parentBox.right - parentBox.left : svgW;
		const filtered = list.filter((it) => {
			const w = it.box.right - it.box.left;
			return w < parentW * 0.9;
		});

		if (filtered.length < 2) continue;

		// Group items into horizontal rows based on vertical overlap
		const rows: RowCandidate[][] = [];
		const sorted = [...filtered].sort((a, b) => a.box.left - b.box.left);

		for (const item of sorted) {
			const itemH = item.box.bottom - item.box.top;
			let placed = false;
			for (const row of rows) {
				const peer = row[0];
				const peerH = peer.box.bottom - peer.box.top;
				const overlapY = Math.min(item.box.bottom, peer.box.bottom) - Math.max(item.box.top, peer.box.top);
				const minH = Math.min(itemH, peerH);
				if (overlapY >= minH * 0.4) {
					row.push(item);
					placed = true;
					break;
				}
			}
			if (!placed) {
				rows.push([item]);
			}
		}

		for (const row of rows) {
			if (row.length < 2) continue;

			row.sort((a, b) => a.box.left - b.box.left);

			// Cluster by height to isolate pills from other elements (like category badges or icons)
			const heights = row.map((it) => it.box.bottom - it.box.top);
			const rowMedianH = median(heights);
			const chips = row.filter((it) => {
				const h = it.box.bottom - it.box.top;
				return Math.abs(h - rowMedianH) <= Math.max(6, rowMedianH * 0.25);
			});

			if (chips.length < 2) continue;

			// Determine dominant Y (top)
			const tops = chips.map((it) => it.box.top);
			let dominantTop = tops[0];
			let maxClusterCount = 0;
			for (const t of tops) {
				const clusterCount = tops.filter((other) => Math.abs(other - t) <= 1.5).length;
				if (clusterCount > maxClusterCount) {
					maxClusterCount = clusterCount;
					dominantTop = t;
				}
			}

			// Determine target gap ("保留距离，参考这图片的间隔")
			const rowGaps: number[] = [];
			for (let i = 0; i < chips.length - 1; i++) {
				const g = chips[i + 1].box.left - chips[i].box.right;
				if (g >= 2 && g <= 60) rowGaps.push(g);
			}

			let targetGap = globalMedianGap;
			if (rowGaps.length > 0) {
				let bestGap = rowGaps[0];
				let bestGapCount = 0;
				for (const g of rowGaps) {
					const count = rowGaps.filter((other) => Math.abs(other - g) <= 1.5).length;
					if (count > bestGapCount) {
						bestGapCount = count;
						bestGap = g;
					}
				}
				targetGap = bestGapCount >= 2 ? bestGap : median(rowGaps);
			}

			if (targetGap < 4 || targetGap > 32) {
				targetGap = globalMedianGap >= 4 && globalMedianGap <= 32 ? globalMedianGap : 8;
			}

			// Layout chips sequentially
			let curLeft = chips[0].box.left;
			for (let i = 0; i < chips.length; i++) {
				const chip = chips[i];
				const w = chip.box.right - chip.box.left;
				const targetLeft = curLeft;
				const targetTop = dominantTop;

				const dx = targetLeft - chip.box.left;
				const dy = targetTop - chip.box.top;

				if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
					nudge(chip.el, dx, dy);
					totalChanged = true;
					totalCount++;
					chip.box.left += dx;
					chip.box.right += dx;
					chip.box.top += dy;
					chip.box.bottom += dy;
				}

				curLeft = chip.box.right + targetGap;
			}
		}
	}

	return { changed: totalChanged, count: totalCount };
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function layoutVerticalColumns(svg: Element): SmartLayoutResult {
	const vbAttr = (svg.getAttribute("viewBox") || svg.getAttribute("viewbox") || "").trim().split(/[\s,]+/);
	const svgW = vbAttr.length === 4 ? parseFloat(vbAttr[2]) : (num(svg.getAttribute("width")) || 800);
	const svgH = vbAttr.length === 4 ? parseFloat(vbAttr[3]) : (num(svg.getAttribute("height")) || 600);
	const pad = 20;
	const preferGap = 24;

	const hidden = (el: Element) => el.getAttribute("display") === "none" || !!el.closest("[data-a1-align]");
	const isCanvas = (box: BoxBounds) => {
		const w = box.right - box.left;
		const h = box.bottom - box.top;
		return w >= svgW * 0.92 && h >= svgH * 0.92;
	};
	const boxOf = (el: Element): BoxBounds | null => {
		const box = measureBox(el, svg);
		if (!box) return null;
		if (box.right - box.left < 48 || box.bottom - box.top < 20) return null;
		if (isCanvas(box)) return null;
		return box;
	};
	const containsBox = (outer: BoxBounds, inner: BoxBounds) => {
		const ow = outer.right - outer.left;
		const oh = outer.bottom - outer.top;
		const iw = inner.right - inner.left;
		const ih = inner.bottom - inner.top;
		if (ow * oh <= iw * ih * 1.12) return false;
		return inner.left >= outer.left - 1 && inner.right <= outer.right + 1
			&& inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
	};

	const cardGroups = Array.from(svg.querySelectorAll("g")).filter((g) => {
		if (hidden(g)) return false;
		return g.querySelector("rect, circle, ellipse, path") !== null;
	});
	// A group that wraps other cards is a frame, not a card. Keep the leaves.
	const atomicGroups = cardGroups.filter((g) => !cardGroups.some((other) => other !== g && other.contains(g)));

	const items: LayoutItem[] = [];
	for (const g of atomicGroups) {
		const box = boxOf(g);
		if (box) items.push({ el: g, box });
	}

	for (const r of Array.from(svg.querySelectorAll("rect"))) {
		if (hidden(r)) continue;
		if (atomicGroups.some((g) => g.contains(r))) continue;
		const w = num(r.getAttribute("width")) ?? 0;
		const h = num(r.getAttribute("height")) ?? 0;
		if (w < 80 || h < 24) continue;
		const box = boxOf(r);
		if (!box) continue;
		items.push({ el: r, box });
	}

	const cards = items.filter((a) => !items.some((b) => a !== b && (a.el.contains(b.el) || containsBox(a.box, b.box))));
	if (cards.length === 0) return { changed: false, count: 0 };

	const centerIn = (box: BoxBounds, item: LayoutItem) => {
		const cx = (item.box.left + item.box.right) / 2;
		const cy = (item.box.top + item.box.bottom) / 2;
		return cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
	};

	let frame: BoxBounds = { left: pad, top: pad, right: svgW - pad, bottom: svgH - pad };
	let frameArea = (frame.right - frame.left) * (frame.bottom - frame.top);
	const considerFrame = (box: BoxBounds | null) => {
		if (!box || isCanvas(box)) return;
		if (!cards.every((c) => centerIn(box, c))) return;
		const area = (box.right - box.left) * (box.bottom - box.top);
		if (area < frameArea) {
			frame = box;
			frameArea = area;
		}
	};
	for (const g of cardGroups) {
		if (cards.some((c) => c.el === g)) continue;
		if (!cards.every((c) => g.contains(c.el))) continue;
		considerFrame(measureBox(g, svg));
	}
	for (const r of Array.from(svg.querySelectorAll("rect"))) {
		if (cards.some((c) => c.el === r || c.el.contains(r))) continue;
		considerFrame(measureBox(r, svg));
	}

	let headerBottom = frame.top;
	const topBand = frame.top + (frame.bottom - frame.top) * 0.4;
	const noteHeader = (box: BoxBounds | null) => {
		if (!box || box.top > topBand) return;
		headerBottom = Math.max(headerBottom, box.bottom);
	};
	for (const g of Array.from(svg.querySelectorAll("g"))) {
		if (hidden(g) || cards.some((c) => c.el === g || c.el.contains(g) || g.contains(c.el))) continue;
		if (!g.querySelector("text") || g.querySelector("rect")) continue;
		noteHeader(measureBox(g, svg));
	}
	for (const t of Array.from(svg.querySelectorAll("text"))) {
		if (hidden(t) || cards.some((c) => c.el === t || c.el.contains(t))) continue;
		noteHeader(measureBox(t, svg));
	}

	const topLimit = Math.max(frame.top + pad, headerBottom + pad);
	const bottomLimit = frame.bottom - pad;
	const leftLimit = frame.left + pad;
	const rightLimit = frame.right - pad;
	const availH = bottomLimit - topLimit;
	const availW = rightLimit - leftLimit;
	if (availH <= 8 || availW <= 8) return { changed: false, count: 0 };

	const columns: LayoutItem[][] = [];
	const sorted = [...cards].sort((a, b) => a.box.left - b.box.left || a.box.top - b.box.top);
	for (const item of sorted) {
		const iw = item.box.right - item.box.left;
		const col = columns.find((group) => group.some((other) => {
			const overlap = Math.min(item.box.right, other.box.right) - Math.max(item.box.left, other.box.left);
			const narrow = Math.min(iw, other.box.right - other.box.left);
			return overlap > narrow * 0.4;
		}));
		if (col) col.push(item);
		else columns.push([item]);
	}

	const ridersOf = (item: LayoutItem): Element[] => {
		const riders: Element[] = [];
		for (const el of Array.from(svg.querySelectorAll("text, circle, ellipse"))) {
			if (item.el.contains(el) || cards.some((c) => c.el === el)) continue;
			const box = measureBox(el, svg);
			if (!box) continue;
			const cx = (box.left + box.right) / 2;
			const cy = (box.top + box.bottom) / 2;
			if (cx >= item.box.left && cx <= item.box.right && cy >= item.box.top && cy <= item.box.bottom) {
				riders.push(el);
			}
		}
		return riders;
	};

	let totalChanged = false;
	let totalCount = 0;
	const slotW = availW / columns.length;

	for (let ci = 0; ci < columns.length; ci++) {
		const col = columns[ci].sort((a, b) => a.box.top - b.box.top);
		const n = col.length;
		const totalH = col.reduce((sum, it) => sum + (it.box.bottom - it.box.top), 0);
		let gap = preferGap;
		let startY = topLimit;
		if (n === 1) {
			startY = topLimit + Math.max(0, (availH - totalH) / 2);
		} else if (availH > totalH) {
			const span = totalH + (n - 1) * preferGap;
			const leftover = availH - span;
			startY = leftover <= 80 ? topLimit + leftover / 2 : topLimit;
		} else {
			gap = Math.max(8, (availH - totalH) / (n - 1));
			startY = topLimit;
		}

		const slotCenter = leftLimit + ci * slotW + slotW / 2;
		const gaps = col.slice(1).map((it, i) => it.box.top - col[i].box.bottom);
		const gapSpread = gaps.length === 0 ? 0 : Math.max(...gaps) - Math.min(...gaps);
		const above = col[0].box.top - headerBottom;
		const below = frame.bottom - col[col.length - 1].box.bottom;
		const centeredX = Math.abs((col[0].box.left + col[0].box.right) / 2 - slotCenter) <= 8;

		const finished = gapSpread <= 4
			&& gaps.every((g) => g >= 8)
			&& above >= 8
			&& below >= 8
			&& above - below <= 40
			&& centeredX;
		if (finished) continue;

		let curY = startY;
		for (const it of col) {
			const itemH = it.box.bottom - it.box.top;
			const itemW = it.box.right - it.box.left;
			const dx = (slotCenter - itemW / 2) - it.box.left;
			const dy = curY - it.box.top;
			if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
				nudge(it.el, dx, dy);
				for (const rider of ridersOf(it)) nudge(rider, dx, dy);
				totalChanged = true;
				totalCount++;
			}
			curY += itemH + gap;
		}
	}

	return { changed: totalChanged, count: totalCount };
}

/**
 * Intelligent layout for cards and chips inside an SVG:
 * 1. Automatically aligns horizontal rows of sibling chips (Y-alignment and even spacing referencing existing gaps).
 * 2. Balances vertical column stacks of cards.
 */
export function smartAutoLayout(svg: Element): SmartLayoutResult {
	let totalChanged = false;
	let totalCount = 0;

	// Phase 1: Horizontal row alignment of sibling cards/chips
	const rowRes = layoutHorizontalRows(svg);
	if (rowRes.changed) {
		totalChanged = true;
		totalCount += rowRes.count;
	}

	// Phase 2: Canvas-level vertical column balancing
	const colRes = layoutVerticalColumns(svg);
	if (colRes.changed) {
		totalChanged = true;
		totalCount += colRes.count;
	}

	return { changed: totalChanged, count: totalCount };
}

