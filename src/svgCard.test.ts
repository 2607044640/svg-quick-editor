import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { cloneCard, commitText, findCard, findTextInCard, nudge, resetCloneSeq, resolveCloneTarget, resolveHit, serializeSvg } from "./svgCard";
import { ensureMarker, findSvgSpans, matchSpan, spliceSvg } from "./svgSource";
import { SvgHistoryManager } from "./svgHistory";

function doc(svg: string): { svg: Element; window: { document: Document } } {
	const { document } = parseHTML(`<!doctype html><body>${svg}</body>`);
	const el = document.querySelector("svg");
	if (!el) throw new Error("no svg");
	return { svg: el, window: { document } };
}

const CHIP = `
<svg viewBox="0 0 200 40">
  <g id="row" data-a1-card="row">
    <rect x="4" y="4" width="180" height="28" rx="6"></rect>
    <text id="label" x="12" y="24">AI 2-其他研究</text>
  </g>
</svg>`;

describe("findCard", () => {
	it("uses data-a1-card when present", () => {
		const { svg } = doc(CHIP);
		const text = svg.querySelector("text")!;
		expect(findCard(text).getAttribute("data-a1-card")).toBe("row");
	});

	it("does not delete sibling sentences that share a group", () => {
		const { svg } = doc(`<svg><g id="board">
			<text id="a">one</text>
			<text id="b">two</text>
		</g></svg>`);
		const a = svg.querySelector("#a")!;
		expect(findCard(a).id).toBe("a");
	});

	it("treats a group with a single text as the chip", () => {
		const { svg } = doc(`<svg><g id="chip"><rect></rect><text id="t">hi</text></g></svg>`);
		expect(findCard(svg.querySelector("#t")!).id).toBe("chip");
	});
});

describe("commitText", () => {
	it("replaces the sentence", () => {
		const { svg } = doc(CHIP);
		const hit = resolveHit(svg.querySelector("text")!)!;
		const result = commitText(hit, "改一个字");
		expect(result.action).toBe("update");
		expect(svg.querySelector("text")!.textContent).toBe("改一个字");
		expect(svg.querySelector("rect")).not.toBeNull();
	});

	it("deletes the whole chip when the text is cleared", () => {
		const { svg } = doc(CHIP);
		const hit = resolveHit(svg.querySelector("text")!)!;
		const result = commitText(hit, "   ");
		expect(result.action).toBe("delete");
		expect(svg.querySelector("g")).toBeNull();
		expect(svg.querySelector("rect")).toBeNull();
		expect(svg.querySelector("text")).toBeNull();
	});

	it("clears only that text when the group holds multiple sentences", () => {
		const { svg } = doc(`<svg><g><rect id="bg"></rect><text id="a">one</text><text id="b">two</text></g></svg>`);
		const hit = resolveHit(svg.querySelector("#a")!)!;
		commitText(hit, "");
		expect(svg.querySelector("#a")).toBeNull();
		expect(svg.querySelector("#b")!.textContent).toBe("two");
		expect(svg.querySelector("#bg")).not.toBeNull();
	});

	it("clears only the edited text when the card has a background rect enclosing multiple texts (big card vs small box)", () => {
		const { svg } = doc(`
<svg viewBox="0 0 600 400">
  <g id="col1">
    <rect id="bg1" x="10" y="10" width="200" height="300" rx="8"></rect>
    <text id="t1" x="20" y="40">Header Title</text>
    <text id="t2" x="20" y="80">Item One</text>
    <text id="t3" x="20" y="120">Item Two</text>
  </g>
</svg>`);
		const hit = resolveHit(svg.querySelector("#t2")!)!;
		const res = commitText(hit, "");
		expect(res.action).toBe("delete");
		expect(svg.querySelector("#t2")).toBeNull();
		expect(svg.querySelector("#t1")!.textContent).toBe("Header Title");
		expect(svg.querySelector("#t3")!.textContent).toBe("Item Two");
		expect(svg.querySelector("#bg1")).not.toBeNull();
		expect(svg.querySelector("#col1")).not.toBeNull();
	});

	it("deletes the small box (dedicated rect) when the text is inside its own small chip, without touching other chips or the column", () => {
		const { svg } = doc(`
<svg viewBox="0 0 600 400">
  <g id="col1">
    <rect id="outer-card" x="10" y="10" width="200" height="300"></rect>
    <text id="t1" x="20" y="40">Column Header</text>
    <g id="chip1">
      <rect id="chip1-rect" x="20" y="60" width="160" height="30"></rect>
      <text id="t2" x="30" y="80">Small Chip One</text>
    </g>
    <g id="chip2">
      <rect id="chip2-rect" x="20" y="110" width="160" height="30"></rect>
      <text id="t3" x="30" y="130">Small Chip Two</text>
    </g>
  </g>
</svg>`);
		const hit = resolveHit(svg.querySelector("#t2")!)!;
		commitText(hit, "");
		expect(svg.querySelector("#t2")).toBeNull();
		expect(svg.querySelector("#chip1-rect")).toBeNull();
		expect(svg.querySelector("#outer-card")).not.toBeNull();
		expect(svg.querySelector("#t1")).not.toBeNull();
		expect(svg.querySelector("#chip2")).not.toBeNull();
		expect(svg.querySelector("#t3")!.textContent).toBe("Small Chip Two");
	});

	it("preserves card background and sibling lines when clearing a text line in short_term_state_decision_flow.svg (yellow box)", () => {
		const { svg } = doc(`
<svg viewBox="0 0 960 500">
  <g transform="translate(495, 92)">
    <rect width="425" height="116" rx="12" fill="url(#cardGrad)" stroke="#f59e0b" stroke-width="1.5" stroke-opacity="0.7"></rect>
    <rect x="12" y="12" width="76" height="22" rx="6" fill="#f59e0b" fill-opacity="0.2"></rect>
    <text id="tag" x="50" y="27" fill="#fbbf24">IF 生理紧绷</text>
    <text id="desc" x="96" y="27" fill="#fde68a">心跳加速 / 胸闷脑胀 / 急性焦虑</text>
    <rect id="bar" x="14" y="40" width="2" height="52" rx="1" fill="#f59e0b" fill-opacity="0.4"></rect>
    <text id="line1" x="24" y="60">→ 💨 生理性叹息3次（连续两次短吸 + 长长呼气）</text>
    <text id="line2" x="24" y="82">→ 物理：冷水洗脸 + 开窗风扇通风吸入清新空气</text>
  </g>
</svg>`);
		const line2 = svg.querySelector("#line2")!;
		const hit = resolveHit(line2)!;
		const res = commitText(hit, "");
		expect(res.action).toBe("delete");
		// line2 is deleted
		expect(svg.querySelector("#line2")).toBeNull();
		// Yellow card rect and all other lines remain 100% intact!
		expect(svg.querySelector("rect[stroke='#f59e0b']")).not.toBeNull();
		expect(svg.querySelector("#tag")?.textContent).toBe("IF 生理紧绷");
		expect(svg.querySelector("#desc")?.textContent).toContain("心跳加速");
		expect(svg.querySelector("#line1")?.textContent).toContain("生理性叹息");
		expect(svg.querySelector("#bar")).not.toBeNull();
	});
});

describe("cloneCard", () => {
	it("offsets the chip and rewrites ids", () => {
		resetCloneSeq(0);
		const { svg } = doc(CHIP);
		const card = svg.querySelector("g")!;
		const clone = cloneCard(card, 0, 36);
		card.parentElement!.appendChild(clone);
		expect(svg.querySelectorAll("g").length).toBe(2);
		expect(clone.id).not.toBe("row");
		expect(clone.querySelector("text")!.textContent).toBe("AI 2-其他研究");
		expect(clone.getAttribute("transform")).toContain("translate(0 36)");
		nudge(clone, 0, 4);
		expect(clone.getAttribute("transform")).toBe("translate(0 40)");
		expect((clone.getAttribute("transform")!.match(/translate/g) ?? []).length).toBe(1);
		const xml = serializeSvg(svg);
		expect(xml).toContain("AI 2-其他研究");
		expect((xml.match(/id="/g) ?? []).length).toBeGreaterThan(2);
	});
});

describe("svgSource", () => {
	const md = "before\n<svg viewBox=\"0 0 10 10\"><text>A</text></svg>\nmiddle\n<svg><text>B</text></svg>\nafter";

	it("finds both svg spans", () => {
		const spans = findSvgSpans(md);
		expect(spans).toHaveLength(2);
		expect(spans[0].inner).toContain(">A<");
		expect(spans[1].inner).toContain(">B<");
	});

	it("splices a replacement without touching the other svg", () => {
		const spans = findSvgSpans(md);
		const next = spliceSvg(md, spans[0], "<svg><text>Z</text></svg>");
		expect(next).toContain(">Z<");
		expect(next).toContain(">B<");
		expect(next.startsWith("before")).toBe(true);
	});

	it("matches by marker first", () => {
		const marked = ensureMarker("<svg><text>A</text></svg>", "s1");
		const md2 = `x ${marked} y <svg><text>B</text></svg>`;
		const span = matchSpan(md2, 1, "s1");
		expect(span!.inner).toContain("data-a1-svg=\"s1\"");
	});
});

describe("findTextInCard", () => {
	it("resolves text directly from a text node", () => {
		const { svg } = doc(CHIP);
		const text = svg.querySelector("text")!;
		expect(findTextInCard(text)?.textContent).toBe("AI 2-其他研究");
	});

	it("resolves text when passed a card rect inside the group", () => {
		const { svg } = doc(CHIP);
		const rect = svg.querySelector("rect")!;
		const text = findTextInCard(rect);
		expect(text).not.toBeNull();
		expect(text?.textContent).toBe("AI 2-其他研究");
	});

	it("resolves text when passed the card group element", () => {
		const { svg } = doc(CHIP);
		const g = svg.querySelector("g")!;
		const text = findTextInCard(g);
		expect(text).not.toBeNull();
		expect(text?.textContent).toBe("AI 2-其他研究");
	});

	it("resolves hit when passed the card rect directly", () => {
		const { svg } = doc(CHIP);
		const rect = svg.querySelector("rect")!;
		const hit = resolveHit(rect);
		expect(hit).not.toBeNull();
		expect(hit?.textEl.textContent).toBe("AI 2-其他研究");
	});

	it("resolves closest text in a multi-card SVG", () => {
		const { svg } = doc(`
<svg viewBox="0 0 400 100">
  <g id="card1">
    <rect x="10" y="10" width="100" height="40"></rect>
    <text x="20" y="30">Card 1 Text</text>
  </g>
  <g id="card2">
    <rect x="200" y="10" width="100" height="40"></rect>
    <text x="210" y="30">Card 2 Text</text>
  </g>
</svg>`);
		const rect2 = svg.querySelector("#card2 rect")!;
		const text = findTextInCard(rect2);
		expect(text?.textContent).toBe("Card 2 Text");
	});

	it("resolves text when start element is a container holding an SVG (e.g. svg-lightbox-content)", () => {
		const { window } = doc(`
<div class="svg-lightbox-content">
  <svg viewBox="0 0 400 100">
    <g id="card4">
      <rect x="200" y="10" width="100" height="40"></rect>
      <text x="210" y="30">基石四·神经重塑</text>
    </g>
  </svg>
</div>`);
		const container = window.document.querySelector(".svg-lightbox-content")!;
		const text = findTextInCard(container, 250, 30);
		expect(text).not.toBeNull();
		expect(text?.textContent).toBe("基石四·神经重塑");
	});
});

describe("resolveCloneTarget", () => {
	const COMPLEX_CARD = `
<svg viewBox="0 0 960 500">
  <rect id="canvasBg" width="960" height="500"></rect>
  <g id="bigCard" transform="translate(40, 92)">
    <rect id="cardBg" width="425" height="116" rx="12"></rect>
    <rect id="badgeRect" x="12" y="12" width="76" height="22"></rect>
    <text id="badgeText" x="50" y="27">IF 情绪烦躁</text>
    <text id="subText" x="96" y="27">坐立难安</text>
    <text id="line1" x="24" y="56">→ 先解决烦躁：玩自己喜欢的游戏</text>
    <text id="line2" x="24" y="74">→ 防诅咒：不工作</text>
  </g>
</svg>`;

	it("returns single text when mouse points to a line text in multi-text card", () => {
		const { svg } = doc(COMPLEX_CARD);
		const line1 = svg.querySelector("#line1")!;
		const target = resolveCloneTarget(line1);
		expect(target).toBe(line1);
	});

	it("returns chip group when mouse points to badge text with adjacent badge rect", () => {
		const { svg } = doc(COMPLEX_CARD);
		const badgeText = svg.querySelector("#badgeText")!;
		const target = resolveCloneTarget(badgeText);
		expect(target).not.toBeNull();
		// Should be a wrapped chip group containing badge rect and badge text
		expect(target?.querySelector("#badgeText")).not.toBeNull();
		expect(target?.querySelector("#badgeRect")).not.toBeNull();
		// Should NOT contain the outer card or other lines
		expect(target?.querySelector("#line1")).toBeNull();
	});

	it("returns the big card <g> when mouse points to the outer card background rect", () => {
		const { svg } = doc(COMPLEX_CARD);
		const cardBg = svg.querySelector("#cardBg")!;
		const target = resolveCloneTarget(cardBg);
		expect(target).not.toBeNull();
		expect(target?.id).toBe("bigCard");
		expect(target?.querySelectorAll("text").length).toBe(4);
	});

	it("returns null when mouse points to the canvas background rect", () => {
		const { svg } = doc(COMPLEX_CARD);
		const canvasBg = svg.querySelector("#canvasBg")!;
		const target = resolveCloneTarget(canvasBg);
		expect(target).toBeNull();
	});

	it("returns dedicated chip group when text is in a single-text group", () => {
		const { svg } = doc(`
<svg viewBox="0 0 400 200">
  <g id="outer">
    <g id="chip1">
      <rect width="80" height="30"></rect>
      <text id="t1">Step 1</text>
    </g>
    <g id="chip2">
      <rect width="80" height="30"></rect>
      <text id="t2">Step 2</text>
    </g>
  </g>
</svg>`);
		const t1 = svg.querySelector("#t1")!;
		const target = resolveCloneTarget(t1);
		expect(target?.id).toBe("chip1");
	});
});

describe("SvgHistoryManager", () => {
	it("records snapshots and performs undo/redo", () => {
		const { svg } = doc(`<svg viewBox="0 0 200 40"><text id="t">Original</text></svg>`);
		const history = new SvgHistoryManager();
		const svgEl = svg as any;

		history.setActiveSvg(svgEl);
		expect(history.isDirty(svgEl)).toBe(false);

		// Record snapshot before mutating
		history.recordSnapshot(svgEl);
		svg.querySelector("#t")!.textContent = "Modified 1";
		expect(history.isDirty(svgEl)).toBe(true);

		// Undo
		const undone = history.undo(svgEl);
		expect(undone).toBe(true);
		expect(svg.querySelector("#t")!.textContent).toBe("Original");
		expect(history.isDirty(svgEl)).toBe(false);

		// Redo
		const redone = history.redo(svgEl);
		expect(redone).toBe(true);
		expect(svg.querySelector("#t")!.textContent).toBe("Modified 1");
		expect(history.isDirty(svgEl)).toBe(true);
	});

	it("discards changes back to initial content", () => {
		const { svg } = doc(`<svg viewBox="0 0 200 40"><text id="t">Initial</text></svg>`);
		const history = new SvgHistoryManager();
		const svgEl = svg as any;

		history.setActiveSvg(svgEl);
		history.recordSnapshot(svgEl);
		history.discard(svgEl);
		expect(svg.querySelector("#t")!.textContent).toBe("Initial");
		expect(history.isDirty(svgEl)).toBe(false);
	});

	it("ignores transient hover classes and remains not dirty when no edits occurred", () => {
		const { svg } = doc(`<svg viewBox="0 0 200 40"><text id="t">Initial</text></svg>`);
		const history = new SvgHistoryManager();
		const svgEl = svg as any;

		history.setActiveSvg(svgEl);
		expect(history.isDirty(svgEl)).toBe(false);

		// Mouse hovers over text adding hover classes
		svg.querySelector("#t")!.classList.add("a1-svg-hover-text");
		expect(history.isDirty(svgEl)).toBe(false);
	});
});



