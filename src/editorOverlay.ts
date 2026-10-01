export interface OverlayHandle {
	input: HTMLInputElement;
	close: () => void;
}

export interface OverlayOptions {
	rect: { left: number; top: number; width: number; height: number };
	value: string;
	fontSize: string;
	fontFamily: string;
	color: string;
	onCommit: (value: string) => void;
	onCancel: () => void;
}

/**
 * Single-line rename box pinned over the SVG text.
 * Enter / blur commits. Escape cancels. IME composition is not treated as Enter.
 */
export function openTextOverlay(parent: HTMLElement, opts: OverlayOptions): OverlayHandle {
	const hasCreateEl = "createEl" in parent && typeof (parent as { createEl?: (tag: string, o?: unknown) => HTMLElement }).createEl === "function";
	const input = hasCreateEl
		? (parent as { createEl: (tag: string, o?: unknown) => HTMLElement }).createEl("input", { type: "text", cls: "a1-svg-edit" }) as HTMLInputElement
		: document.createElement("input");
	if (input.parentElement !== parent) {
		input.type = "text";
		input.className = "a1-svg-edit";
	}
	input.value = opts.value;
	input.setAttribute("aria-label", "Edit SVG text");
	const width = Math.max(opts.rect.width + 24, 80);
	const height = Math.max(opts.rect.height + 6, 26);
	input.style.left = `${Math.round(opts.rect.left)}px`;
	input.style.top = `${Math.round(opts.rect.top - 2)}px`;
	input.style.width = `${Math.round(width)}px`;
	input.style.height = `${Math.round(height)}px`;
	input.style.fontSize = opts.fontSize || "14px";
	input.style.fontFamily = opts.fontFamily || "inherit";
	input.style.color = opts.color || "inherit";

	let closed = false;
	let composing = false;

	// Suppress Alt key release default behavior so Windows Electron does not steal focus to the application menu
	const suppressAlt = (e: KeyboardEvent) => {
		if (e.key === "Alt") {
			e.preventDefault();
		}
	};
	window.addEventListener("keyup", suppressAlt, { capture: true });

	const close = () => {
		if (closed) return;
		closed = true;
		window.removeEventListener("keyup", suppressAlt, { capture: true });
		input.remove();
	};
	const commit = () => {
		if (closed) return;
		const value = input.value;
		close();
		opts.onCommit(value);
	};
	const cancel = () => {
		if (closed) return;
		close();
		opts.onCancel();
	};

	input.addEventListener("compositionstart", () => {
		composing = true;
	});
	input.addEventListener("compositionend", () => {
		composing = false;
	});
	input.addEventListener("keydown", (e) => {
		if (e.isComposing || composing || e.key === "Process") return;
		if (e.key === "Enter") {
			e.preventDefault();
			e.stopPropagation();
			commit();
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			cancel();
		}
	});
	const mountTime = Date.now();
	input.addEventListener("blur", () => {
		if (closed) return;
		// If window itself lost focus (e.g. Alt key menu activation on Windows, or alt-tabbing), keep editing alive
		if (typeof document !== "undefined" && !document.hasFocus()) {
			return;
		}
		// Prevent accidental immediate blur during keyboard shortcut release (e.g. Alt release on Windows)
		if (Date.now() - mountTime < 350) {
			input.focus();
			return;
		}
		// Let click-outside and Enter settle before blur commits
		window.setTimeout(() => {
			if (!closed) commit();
		}, 60);
	});

	parent.appendChild(input);
	input.focus();
	input.select();
	return { input, close };
}
