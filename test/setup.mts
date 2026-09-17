// DOM test harness: installs happy-dom's document/window and the common
// element/event constructors onto globalThis so DOM-building logic can be
// unit-tested under `node --test` with no browser. Import this FIRST in any
// *.test.mts that touches the DOM.

import { Window } from "happy-dom";

const win = new Window({ url: "https://xpui.app.spotify.com" });

for (
	const key of [
		"document",
		"window",
		"Node",
		"Element",
		"HTMLElement",
		"HTMLButtonElement",
		"HTMLInputElement",
		"HTMLDivElement",
		"HTMLSpanElement",
		"Event",
		"CustomEvent",
		"MouseEvent",
		"KeyboardEvent",
	] as const
) {
	(globalThis as Record<string, unknown>)[key] = key === "window"
		? win
		: (win as unknown as Record<string, unknown>)[key];
}
