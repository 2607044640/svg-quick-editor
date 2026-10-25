export function cleanSvgHtml(html: string): string {
	return html
		.replace(/\s+class="([^"]*)"/g, (_match, clsVal: string) => {
			const cleaned = clsVal
				.split(/\s+/)
				.filter((c) => c && c !== "a1-svg-hover-text" && c !== "a1-svg-hover-image")
				.join(" ");
			return cleaned ? ` class="${cleaned}"` : "";
		})
		.replace(/\s+data-a1-[a-z0-9_-]+(?:="[^"]*")?/g, "")
		.replace(/<g\b[^>]*\bdata-a1-align="1"[^>]*>[\s\S]*?<\/g>/g, "")
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
			if (!root || root.tagName.toLowerCase() === "parsererror" || root.querySelector("parsererror")) {
				return;
			}
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
 * In-memory Undo/Redo and Dirty-State manager for SVG editing.
 * Tracks snapshots and saved baseline per SVG element during an editing session.
 */
export class SvgHistoryManager {
	private savedContent = new WeakMap<SVGSVGElement, string>();
	private dirtyFlags = new WeakMap<SVGSVGElement, boolean>();
	private undoStacks = new WeakMap<SVGSVGElement, string[]>();
	private redoStacks = new WeakMap<SVGSVGElement, string[]>();
	private maxStackSize = 50;
	private activeSvg: SVGSVGElement | null = null;

	public setActiveSvg(svg: SVGSVGElement | null): void {
		this.activeSvg = svg;
		if (svg && !this.savedContent.has(svg)) {
			this.savedContent.set(svg, cleanSvgHtml(svg.innerHTML));
			this.dirtyFlags.set(svg, false);
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
		this.recordExplicitSnapshot(svg, currentHtml);
	}

	/**
	 * Records a pre-captured snapshot string before a multi-step or live-preview mutation.
	 */
	public recordExplicitSnapshot(svg: SVGSVGElement, snapshotHtml: string): void {
		this.setActiveSvg(svg);
		const cleaned = cleanSvgHtml(snapshotHtml);
		const stack = this.undoStacks.get(svg) || [];
		if (stack.length === 0 || stack[stack.length - 1] !== cleaned) {
			stack.push(cleaned);
			if (stack.length > this.maxStackSize) {
				stack.shift();
			}
			this.undoStacks.set(svg, stack);
		}
		this.redoStacks.set(svg, []);
		this.dirtyFlags.set(svg, true);
	}

	/**
	 * Pops the latest snapshot if a tentative operation resulted in no actual DOM change.
	 */
	public popSnapshot(svg?: SVGSVGElement | null): void {
		const target = svg ?? this.getActiveSvg();
		if (!target) return;
		const stack = this.undoStacks.get(target);
		if (stack && stack.length > 0) {
			stack.pop();
			this.undoStacks.set(target, stack);
		}
		this.syncDirtyFlag(target);
	}

	/**
	 * Re-evaluates and updates the dirty flag for the given SVG against its saved baseline.
	 */
	public markDirty(svg?: SVGSVGElement | null): void {
		const target = svg ?? this.getActiveSvg();
		if (!target) return;
		this.setActiveSvg(target);
		this.syncDirtyFlag(target);
	}

	private syncDirtyFlag(target: SVGSVGElement): void {
		const saved = this.savedContent.get(target);
		if (saved == null) {
			this.dirtyFlags.set(target, false);
			return;
		}
		const isDifferent = cleanSvgHtml(target.innerHTML) !== saved;
		this.dirtyFlags.set(target, isDifferent);
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
		this.syncDirtyFlag(target);
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
		this.syncDirtyFlag(target);
		return true;
	}

	public isDirty(svg?: SVGSVGElement | null): boolean {
		const target = svg ?? this.getActiveSvg();
		if (!target) return false;
		if (!this.dirtyFlags.get(target)) {
			return false;
		}
		const saved = this.savedContent.get(target);
		if (saved == null) return false;
		const isDifferent = cleanSvgHtml(target.innerHTML) !== saved;
		if (!isDifferent) {
			this.dirtyFlags.set(target, false);
		}
		return isDifferent;
	}

	public getInitialContent(svg?: SVGSVGElement | null): string | null {
		const target = svg ?? this.getActiveSvg();
		if (!target) return null;
		return this.savedContent.get(target) ?? null;
	}

	public discard(svg?: SVGSVGElement | null): void {
		const target = svg ?? this.getActiveSvg();
		if (!target) return;
		const saved = this.savedContent.get(target);
		if (saved != null) {
			replaceSvgChildrenFromMarkup(target, saved);
		}
		this.dirtyFlags.set(target, false);
		this.clear(target);
	}

	public markSaved(svg?: SVGSVGElement | null, keepHistory = false): void {
		const target = svg ?? this.getActiveSvg();
		if (!target) return;
		this.savedContent.set(target, cleanSvgHtml(target.innerHTML));
		this.dirtyFlags.set(target, false);
		if (!keepHistory) {
			this.clear(target);
		}
	}

	public clear(svg?: SVGSVGElement | null): void {
		const target = svg ?? this.getActiveSvg();
		if (target) {
			this.undoStacks.set(target, []);
			this.redoStacks.set(target, []);
			this.dirtyFlags.set(target, false);
		}
		if (this.activeSvg === target) {
			this.activeSvg = null;
		}
	}
}
