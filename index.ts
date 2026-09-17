import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

export async function load(ctx: ModuleRuntimeContext) {
	return (await import("./mod.js")).default(ctx);
}
