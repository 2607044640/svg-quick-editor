export function cleanSvgHtml(html: string): string {
	return html
		.replace(/\s*class="[^"]*a1-svg-hover-[^"]*"/g, "")
		.replace(/\s*a1-svg-hover-text/g, "")
		.replace(/\s*a1-svg-hover-image/g, "")
		.replace(/\s+data-a1-[a-z0-9_-]+(?:="[^"]*")?/g, "")
		.trim();
}

/**
 * Safely parses and replaces all child nodes of an SVG element from a markup string
 * using DOMParser, completely avoiding unsafe DOM injection.
 */
export function replaceSvgChildrenFromMarkup(target: SVGSVGElement, markup: string): void {
	const doc = target.ownerDocument || (typeof document !== "undefined" ? document : null);
	const parserConstructor = typeof DOMParser !== "undefined" ? DOMParser : null;
	if (parserConstructor) {
		try {
			const parsedDoc = new parserConstructor().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, "image/svg+xml");
			const root = parsedDoc.documentElement;
			while (target.firstChild) {
				target.removeChild(target.firstChild);
			}
			while (root.firstChild) {
				const node = doc?.adoptNode ? doc.adoptNode(root.firstChild) : root.firstChild;
				target.appendChild(node);
			}
		} catch (e) {
			console.error("DOMParser error in replaceSvgChildrenFromMarkup:", e);
		}
	}
}

/**
 * In-memory Undo/Redo history manager for SVG editing.
 * Tracks temporary snapshots per SVG element during an editing session.
 */
export class SvgHistoryManager {
	private initialContent = new WeakMap<SVGSVGElement, string>();
	private undoStacks = new WeakMap<SVGSVGElement, string[]>();
	private redoStacks = new WeakMap<SVGSVGElement, string[]>();
	private maxStackSize = 50;
	private activeSvg: SVGSVGElement | null = null;

	public setActiveSvg(svg: SVGSVGElement | null): void {
		this.activeSvg = svg;
		if (svg && !this.initialContent.has(svg)) {
			this.initialContent.set(svg, cleanSvgHtml(svg.innerHTML));
			this.undoStacks.set(svg, []);
			this.redoStacks.set(svg, []);
		}
	}

	public getActiveSvg(): SVGSVGElement | null {
		if (this.activeSvg && this.activeSvg.isConnected) {
			return this.activeSvg;
		}
		if (typeof document !== "undefined") {
			const modalSvg = document.querySelector(".svg-lightbox-body svg, .svg-lightbox-content svg, .a1-svg-modal-body svg") as SVGSVGElement | null;
			if (modalSvg) {
				this.setActiveSvg(modalSvg);
				return modalSvg;
			}
		}
		return null;
	}

	/**
	 * Records a snapshot of the SVG content before mutation so it can be reverted via Undo.
	 */
	public recordSnapshot(svg: SVGSVGElement): void {
		this.setActiveSvg(svg);
		const currentHtml = cleanSvgHtml(svg.innerHTML);
		const stack = this.undoStacks.get(svg) || [];
		if (stack.length === 0 || stack[stack.length - 1] !== currentHtml) {
			stack.push(currentHtml);
			if (stack.length > this.maxStackSize) {
				stack.shift();
			}
			this.undoStacks.set(svg, stack);
		}
		this.redoStacks.set(svg, []);
	}

	public undo(svg?: SVGSVGElement | null): boolean {
		const target = svg ?? this.getActiveSvg();
		if (!target) return false;
		const undoStack = this.undoStacks.get(target);
		if (!undoStack || undoStack.length === 0) return false;

		const currentHtml = cleanSvgHtml(target.innerHTML);
		const prevHtml = undoStack.pop()!;

		const redoStack = this.redoStacks.get(target) || [];
		redoStack.push(currentHtml);
		this.redoStacks.set(target, redoStack);

		replaceSvgChildrenFromMarkup(target, prevHtml);
		return true;
	}

	public redo(svg?: SVGSVGElement | null): boolean {
		const target = svg ?? this.getActiveSvg();
		if (!target) return false;
		const redoStack = this.redoStacks.get(target);
		if (!redoStack || redoStack.length === 0) return false;

		const currentHtml = cleanSvgHtml(target.innerHTML);
		const nextHtml = redoStack.pop()!;

		const undoStack = this.undoStacks.get(target) || [];
		undoStack.push(currentHtml);
		this.undoStacks.set(target, undoStack);

		replaceSvgChildrenFromMarkup(target, nextHtml);
		return true;
	}

	public isDirty(svg?: SVGSVGElement | null): boolean {
		const target = svg ?? this.getActiveSvg();
		if (!target) return false;
		const undoStack = this.undoStacks.get(target);
		// If no modifications have been recorded in the undo stack, it is definitely not dirty
		if (!undoStack || undoStack.length === 0) {
			return false;
		}
		const initial = this.initialContent.get(target);
		if (initial == null) return false;
		return cleanSvgHtml(target.innerHTML) !== cleanSvgHtml(initial);
	}

	public getInitialContent(svg?: SVGSVGElement | null): string | null {
		const target = svg ?? this.getActiveSvg();
		if (!target) return null;
		return this.initialContent.get(target) ?? null;
	}

	public discard(svg?: SVGSVGElement | null): void {
		const target = svg ?? this.getActiveSvg();
		if (!target) return;
		const initial = this.initialContent.get(target);
		if (initial != null) {
			replaceSvgChildrenFromMarkup(target, initial);
		}
		this.clear(target);
	}

	public markSaved(svg?: SVGSVGElement | null): void {
		const target = svg ?? this.getActiveSvg();
		if (!target) return;
		this.initialContent.set(target, cleanSvgHtml(target.innerHTML));
		this.clear(target);
	}

	public clear(svg?: SVGSVGElement | null): void {
		const target = svg ?? this.getActiveSvg();
		if (target) {
			this.undoStacks.set(target, []);
			this.redoStacks.set(target, []);
		}
		if (this.activeSvg === target) {
			this.activeSvg = null;
		}
	}
}
