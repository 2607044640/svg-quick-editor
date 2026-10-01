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

	const rects = Array.from(parent.children).filter((c) => localName(c) === "rect");
	for (const r of rects) {
		const w = num(r.getAttribute("width")) ?? 0;
		const h = num(r.getAttribute("height")) ?? 0;
		if (w <= 0 || w > 220 || h <= 0 || h > 65) continue;
		if (w <= 4 || h <= 4) continue; // Skip thin divider lines

		const rx = num(r.getAttribute("x")) ?? 0;
		const ry = num(r.getAttribute("y")) ?? 0;
		if (tx >= rx - 15 && tx <= rx + w + 15 && ty >= ry && ty <= ry + h + 8) {
			return r;
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
	const isSvgRoot = (typeof (target as any).instanceOf === "function" ? (target as any).instanceOf(SVGSVGElement) : false) || localName(target) === "svg";
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
		const isSmall = (w > 0 && w <= 220 && h > 0 && h <= 65 && w > 4 && h > 4);

		if (isSmall) {
			const parentG = target.closest("g");
			if (parentG && parentG !== svg && countTexts(parentG) === 1) {
				return parentG;
			}
			const associatedText = findTextInCard(target, clientX, clientY);
			if (associatedText && associatedText.parentElement === target.parentElement) {
				return wrapInChipGroup(target, associatedText);
			}
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

	const isSvg = (typeof (start as any).instanceOf === "function" ? (start as any).instanceOf(SVGSVGElement) : false) || localName(start) === "svg";
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
	if (name === "g" || name === "svg" || name === "use" || el.hasAttribute("transform")) {
		const prev = el.getAttribute("transform") ?? "";
		const m = prev.match(/translate\(\s*([-\d.]+)\s*[ ,]\s*([-\d.]+)\s*\)\s*$/);
		if (m) {
			const x = parseFloat(m[1]) + dx;
			const y = parseFloat(m[2]) + dy;
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
			el.setAttribute(attr, v.replace(/url\(#([^)]+)\)|#([A-Za-z_][\w:.-]*)/g, (m, urlId, hashId) => {
				const id = urlId || hashId;
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
	const name = el.localName || el.tagName;
	const attrs: string[] = [];
	for (let i = 0; i < el.attributes.length; i++) {
		const a = el.attributes[i];
		if (a.name === "data-a1-svg-path") continue;
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

export function resetCloneSeq(n = 0): void {
	cloneSeq = n;
}
