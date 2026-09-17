/*
 * "Better Spotify Genres" ported to the v3 module standard. Displays the
 * genres of the current track in the native now-playing bar and links each
 * one to the curated "The Sound of Spotify" playlist.
 *
 * The genres text must live inside Spotify's own track-info container, so
 * this module reads (and a priori writes) Spotify-owned DOM. There is no
 * classmap leaf for that container (main.playbar.widget.info is unpopulated
 * in current classmaps), so we anchor on the stable `main-trackInfo-*`
 * semantic classes Spotify keeps for the player bar. Documented as a
 * `client-dom` boundary exception in metadata.json.
 */

import { client, createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

import {
	addGenreRowToGridTemplate,
	readConfig,
	mergeAndWriteConfig,
	prettifyGenre,
	escapeHtml,
	isSoundOfSpotifyPlaylist,
	isRejectedPlaylist,
	camelize,
	defaultConfig,
	fetchGenresFromMusicBrainz,
	type CacheConfig,
	type GenrePlaylist,
} from "./logic.ts";

/** Verbose per-songchange logging is opt-in via storage `showGenre:debug`. */
let debugEnabled = false;

const genlog = (level: "info" | "warn" | "error" | "debug", ...args: Array<unknown>) => {
	if (level === "debug" && !debugEnabled) return;
	const fn = level === "debug" ? "log" : level;
	// eslint-disable-next-line no-console
	console[fn]("\x1b[35m[better-spotify-genres]\x1b[0m", `[${level}]`, ...args);
};

let trackInfoContainer: HTMLElement | null = null;
let trackGenresContainer: HTMLElement | null = null;

/**
 * Marquee state for an overflowing genres row. Spotify scrolls the
 * now-playing line on hover (~12px/s, a 1s hold at each end, ping-pong);
 * the old extension inherited that through the `ellipsis-one-line` class,
 * which no longer scrolls, so the module drives the same interaction with
 * the Web Animations API.
 */
let marqueeAnimation: Animation | null = null;

/** Identifies the latest marquee invocation; superseded runs bail out. */
let marqueeRunId = 0;

/** Wakes a run that is parked with no overflow when a newer run starts. */
let abortParkedRun: (() => void) | null = null;

/** Stop any in-flight marquee (run superseded or genres cleared). */
function stopMarquee(): void {
	marqueeRunId++;
	abortParkedRun?.();
	abortParkedRun = null;
	marqueeAnimation?.cancel();
	marqueeAnimation = null;
}

const MARQUEE_SPEED_PX_PER_S = 12;
const MARQUEE_HOLD_MS = 1000;

const wait = (ms: number): Promise<void> => {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
};

const nextAnimationFrame = (): Promise<void> => {
	const { promise, resolve } = Promise.withResolvers<void>();
	requestAnimationFrame(() => resolve());
	return promise;
};

/**
 * Scroll `track` horizontally inside `viewport`, pausing while the pointer is
 * over it. One pass out and one pass back (~12px/s with a 1s hold at each
 * end, matching Spotify's own marquee), then it rests at the start until the
 * next pointer leave.
 */
async function runMarquee(viewport: HTMLElement, track: HTMLElement): Promise<void> {
	const runId = ++marqueeRunId;
	marqueeAnimation?.cancel();
	marqueeAnimation = null;

	// Defer measurement until the row is attached to the laid-out grid.
	await nextAnimationFrame();
	if (runId !== marqueeRunId) return;

	const measure = (): number => Math.max(track.getBoundingClientRect().width - viewport.clientWidth, 0);

	// Pointer may already be over the row when a resize restarts the run;
	// pointerenter won't fire again, so seed the state from :hover.
	let hovered = viewport.matches(":hover") || viewport.contains(document.activeElement);
	const pause = (): void => {
		hovered = true;
		marqueeAnimation?.pause();
	};
	const resume = (): void => {
		hovered = false;
		marqueeAnimation?.play();
	};
	viewport.addEventListener("pointerenter", pause);
	viewport.addEventListener("pointerleave", resume);
	viewport.addEventListener("focusin", pause);
	const blur = (): void => {
		// Focus moving between anchors inside the row is not a real leave.
		if (!viewport.contains(document.activeElement)) resume();
	};
	viewport.addEventListener("focusout", blur);

	// Geometry can change on either side: sidebar/window resize shrinks the
	// viewport; web fonts or a re-injected row can widen the content.
	// A change mid-animation restarts the run so the keyframe distance stays
	// exact; while parked it just wakes the loop.
	let currentDistance = measure();
	let resizeSignal: (() => void) | null = null;
	const resizeObserver = new ResizeObserver(() => {
		if (runId !== marqueeRunId) {
			resizeObserver.disconnect();
			return;
		}
		const next = measure();
		if (next === currentDistance) return;
		currentDistance = next;
		if (marqueeAnimation) void runMarquee(viewport, track);
		else resizeSignal?.();
	});
	resizeObserver.observe(viewport);
	resizeObserver.observe(track);

	try {
		let direction: "normal" | "reverse" = "normal";
		// Spotify autoplays the first pass and the return, then rests at the
		// start and replays on the next pointer leave.
		let autoPlay = true;
		while (runId === marqueeRunId) {
			currentDistance = measure();
			if (currentDistance === 0) {
				// Park instead of exiting: content may start overflowing
				// later (font swap, window resize).
				const { promise, resolve } = Promise.withResolvers<void>();
				abortParkedRun = resolve;
				resizeSignal = resolve;
				await promise;
				if (runId === marqueeRunId) abortParkedRun = null;
				continue;
			}
			const distance = currentDistance;

			const keyframes =
				direction === "normal"
					? [{ transform: "translateX(0)" }, { transform: `translateX(${-distance}px)` }]
					: [{ transform: `translateX(${-distance}px)` }, { transform: "translateX(0)" }];
			const animation = track.animate(keyframes, {
				duration: (distance / MARQUEE_SPEED_PX_PER_S) * 1000,
				iterations: 1,
				fill: "both",
				easing: "linear",
			});
			marqueeAnimation = animation;
			animation.pause();

			if (autoPlay) {
				await wait(MARQUEE_HOLD_MS);
				if (runId !== marqueeRunId) return;
				if (!hovered) animation.play();
			}

			await animation.finished;
			direction = direction === "normal" ? "reverse" : "normal";
			autoPlay = direction === "reverse";
		}
	} catch {
		// `cancel()` rejects `finished`: a newer run or clearGenres won.
	} finally {
		resizeSignal = null;
		resizeObserver.disconnect();
		viewport.removeEventListener("pointerenter", pause);
		viewport.removeEventListener("pointerleave", resume);
		viewport.removeEventListener("focusin", pause);
		viewport.removeEventListener("focusout", blur);
	}
}

/**
 * Bumped on every `updateGenres` run so an in-flight (slower) run cannot inject
 * genres after a newer run has already superseded it.
 */
let updateToken = 0;

/** Wait for a selector to appear in the DOM (bounded so we never hang). */
async function waitForElement<T extends HTMLElement = HTMLElement>(
	selector: string,
	location: ParentNode = document,
	timeoutMs = 1500,
): Promise<T | null> {
	const existing = location.querySelector<T>(selector);
	if (existing) return existing;

	return new Promise<T | null>((resolve) => {
		const observer = new MutationObserver(() => {
			const found = location.querySelector<T>(selector);
			if (found) {
				observer.disconnect();
				resolve(found);
			}
		});
		observer.observe(location as Node, { childList: true, subtree: true });
		setTimeout(() => {
			observer.disconnect();
			resolve(null);
		}, timeoutMs);
	});
}

/** Resolve the container that holds the track title/artist links. */
async function resolveTrackInfoContainer(): Promise<HTMLElement | null> {
	const candidates = await Promise.all([
		waitForElement<HTMLElement>("div.main-trackInfo-container"),
		waitForElement<HTMLElement>("div.main-nowPlayingWidget-trackInfo"),
	]);
	return candidates.find((c) => c !== null) ?? null;
}

/** Remove the genres element we injected and restore the grid template. */
function clearGenres(): void {
	stopMarquee();
	if (trackInfoContainer && trackGenresContainer) {
		trackInfoContainer.style.removeProperty("grid-template");
		trackGenresContainer.remove();
	}
	trackInfoContainer = null;
	trackGenresContainer = null;
}

function makeGenreAnchor(uri: string | null, genre: string): string {
	const label = escapeHtml(prettifyGenre(genre));
	if (!uri || isRejectedPlaylist(uri)) {
		return `<a class="spicetify-genres-item" href="#">${label}</a>`;
	}
	return `<a class="spicetify-genres-item" href="${escapeHtml(uri)}">${label}</a>`;
}

/**
 * Fallback definition for Spotify's playlist-search query.
 *
 * The live definition is normally resolved by
 * `client.graphQL.Definitions.searchPlaylists`, but that map only contains the
 * query once Spotify's search chunk has been evaluated (it lives in a lazily
 * loaded bundle). Passing the persisted-query hash directly works before then
 * — the same pattern official modules use for definitions from older Spotify
 * versions — so playlist links resolve without the user opening search first.
 */
const SEARCH_PLAYLISTS_FALLBACK = {
	name: "searchPlaylists",
	operation: "query",
	sha256Hash: "d520014e748f9ea44f7707d8df1819867ac1205e8b7f3e28f22fe5fc858921b1",
	value: null,
};

/**
 * Variables Spotify's own search page sends for a playlist search. The extra
 * feature flags matter: without them the backend returns unrelated
 * recommendations instead of the on-name "The Sound of <genre>" match.
 */
function buildSearchVariables(genre: string, limit: number): Record<string, unknown> {
	return {
		searchTerm: `The Sound of ${genre}`,
		offset: 0,
		limit,
		numberOfTopResults: 0,
		includeAudiobooks: true,
		includeArtistHasConcertsField: false,
		includePreReleases: true,
		includeAlbumPreReleases: true,
		includeAuthors: true,
		includeEpisodeContentRatingsV2: true,
	};
}

/** Search Spotify for the "The Sound of <genre>" playlist owned by the official curator. */
async function fetchSoundOfSpotifyPlaylist(genre: string, cache: CacheConfig): Promise<GenrePlaylist> {
	const cached = cache.cached[camelize(genre)];
	if (cached !== undefined) return { uri: cached, genre };

	let found: { uri: string } | null = null;
	const def = client.graphQL.Definitions.searchPlaylists ?? SEARCH_PLAYLISTS_FALLBACK;

	try {
		const response = (await client.graphQL.Request(def, buildSearchVariables(genre, 20))) as {
			data?: unknown;
			errors?: Array<{ message?: string }>;
		};
		if (response.errors?.length) {
			genlog("warn", `GraphQL search errored for "${genre}":`, response.errors[0]?.message);
		}
		found = findOfficialPlaylist(response.data, genre);
		if (!found) genlog("warn", `GraphQL did not resolve "The Sound of ${genre}" to an official playlist.`);
	} catch (error) {
		genlog("warn", `GraphQL search failed for "${genre}"`, error);
	}

	// Last resort: the public Web API search through the authenticated Cosmos
	// transport (occasionally rate-limited).
	if (!found) found = await searchSoundOfSpotifyPlaylistWebApi(genre);

	if (!found) {
		genlog("debug", `no playlist link resolved for "${genre}"; rendering genre without one`);
		return { uri: null, genre };
	}

	// Mutate the shared cache in place before persisting: concurrent
	// resolutions (Promise.all over the genres) must not each build on a stale
	// snapshot, and the in-memory config has to reflect the hit immediately or
	// every later songchange would search for it again.
	cache.cached[camelize(genre)] = found.uri;
	mergeAndWriteConfig(cache, {}, (k, v) => client.storage.set(k, v));
	return { uri: found.uri, genre };
}

/**
 * Search the Spotify Web API for "The Sound of <genre>" via the authenticated
 * Cosmos transport, and return the official curator's playlist URI if found.
 */
async function searchSoundOfSpotifyPlaylistWebApi(genre: string): Promise<{ uri: string } | null> {
	const cosmos = client.cosmos;
	if (!cosmos?.get) {
		genlog("debug", "no Cosmos transport available for playlist search");
		return null;
	}
	const query = `The Sound of ${genre}`;
	const url = `https://api.spotify.com/v1/search?type=playlist&limit=1&q=${encodeURIComponent(query)}`;
	try {
		const data = (await cosmos.get(url)) as {
			playlists?: { items?: Array<{ name?: string; uri?: string; owner?: { display_name?: string } }> };
		};
		const item = data?.playlists?.items?.[0];
		if (!item?.name || !item?.uri) return null;
		if (!isSoundOfSpotifyPlaylist(item.name, genre)) return null;
		const owner = item.owner?.display_name ?? "";
		if (owner && owner.toLowerCase() !== "the sound of spotify") return null;
		return { uri: item.uri };
	} catch (error) {
		genlog("warn", `Web API search failed for "${genre}"`, error);
		return null;
	}
}

type SearchItem = { name?: unknown; owner?: unknown; uri?: unknown };

/** Field extraction tolerates the many shapes Spotify returns for a search row. */
function searchItemFields(raw: Record<string, unknown>): SearchItem {
	const data = raw.data as Record<string, unknown> | undefined;
	const ownerV2 = (raw.ownerV2 ?? data?.ownerV2) as Record<string, unknown> | undefined;
	return {
		name: raw.name ?? data?.name,
		owner: (ownerV2?.data as Record<string, unknown> | undefined)?.username,
		uri: raw.uri ?? data?.uri,
	};
}

/** Pull the first "The Sound of Spotify"-owned playlist out of a search response. */
function findOfficialPlaylist(data: unknown, genre: string): { uri: string } | null {
	for (const raw of extractSearchItems(data)) {
		const { name, owner, uri } = searchItemFields(raw);
		if (typeof uri !== "string" || typeof name !== "string") continue;
		if (isSoundOfSpotifyPlaylist(name, genre) && (owner === undefined || owner === "thesoundsofspotify")) {
			return { uri };
		}
	}
	return null;
}

function extractSearchItems(data: unknown): Array<Record<string, unknown>> {
	const root = data as Record<string, unknown> | undefined;
	const searchV2 = root?.["searchV2"] as Record<string, unknown> | undefined;
	const playlists = (searchV2?.playlists ?? root?.["playlists"]) as Record<string, unknown> | undefined;
	const items = playlists?.items;
	return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
}

/**
 * Inject the genres row into the now-playing info container.
 */
async function injectGenres(genres: string[], token: number): Promise<void> {
	if (token !== updateToken) return;
	if (genres.length === 0) {
		clearGenres();
		return;
	}

	trackInfoContainer = await resolveTrackInfoContainer();
	if (token !== updateToken) return;
	if (trackInfoContainer === null) {
		genlog("error", "Couldn't find the track-info container; genres will not be displayed.");
		return;
	}

	const container = trackInfoContainer!;
	// Resolve a "The Sound of <genre>" playlist for each genre when possible.
	// A genre always renders even if no playlist resolves (it degrades to a
	// non-navigable "#" link), so the genres show regardless of GraphQL/search
	// availability.
	const playlists = await Promise.all(genres.map((genre) => fetchSoundOfSpotifyPlaylist(genre, CONFIG)));
	if (token !== updateToken) return;
	genlog("debug", "genre -> playlist resolution:", playlists);

	const items = playlists.map((p) => makeGenreAnchor(p.uri, p.genre)).join("<span>, </span>");
	if (!trackGenresContainer) trackGenresContainer = document.createElement("div");
	trackGenresContainer!.className = "spicetify-genres";
	trackGenresContainer!.style.gridArea = "genres";
	trackGenresContainer!.innerHTML = `<span class="spicetify-genres-track">${items}</span>`;

	container.style.setProperty(
		"grid-template",
		addGenreRowToGridTemplate(window.getComputedStyle(container).getPropertyValue("grid-template")),
	);
	container.appendChild(trackGenresContainer!);

	// No-ops (and never errors) when the row fits; only starts when it overflows.
	const track = trackGenresContainer!.querySelector<HTMLElement>(".spicetify-genres-track");
	if (track) void runMarquee(trackGenresContainer!, track);
}

/** Sparkline hover is handled by index.scss `.spicetify-genres-item:hover`. */

// Seeded with defaults; the persisted values are read in `load()`, once the
// client is guaranteed to be available (module top-level runs at import time).
let CONFIG: CacheConfig = { cached: { ...defaultConfig.cached } };

/**
 * Resolve a fetch that can reach MusicBrainz from inside Spotify.
 *
 * Spotify's page CSP blocks direct cross-origin fetches, and the local daemon
 * (the CORS proxy's preferred first hop) has its egress refused by MusicBrainz
 * with a persistent 503. MusicBrainz does accept the hosted proxy, and since
 * the proxy only falls back to it when a request *throws* (an HTTP 503 is a
 * normal resolved response), the hosted hop is never reached on its own. So we
 * resolve the MusicBrainz fetch directly against the first non-daemon template
 * in the configured chain (typically the hosted proxy), honoring a user-set
 * custom proxy while skipping the local daemon. Falls back to the global fetch
 * when no proxy is configured at all.
 */
function resolveMusicBrainzFetch(): typeof fetch {
	const proxy = client.corsProxy;
	if (!proxy?.templates) {
		genlog("debug", "no CORS proxy available, using global fetch");
		return fetch;
	}
	try {
		// Prefer a user override; otherwise skip the local daemon, whose egress
		// MusicBrainz rejects, and use the next link (the hosted proxy).
		const templates = proxy.templates();
		genlog("debug", "CORS proxy templates:", templates);
		const hosted = templates.find((t) => !/127\.0\.0\.1|localhost/.test(t));
		if (hosted) {
			genlog("debug", "using hosted MusicBrainz fetch through:", hosted);
			return (input, init) => fetch(hosted.replace("{url}", String(input)), init);
		}
		genlog("debug", "only local daemon template present, using global fetch", templates);
	} catch (error) {
		genlog("debug", "resolving proxy chain failed, using global fetch", error);
	}
	return fetch;
}

export default async function (ctx: ModuleRuntimeContext) {
	createRegistrar(ctx);
	genlog("info", "module loaded, version 0.1.0");

	CONFIG = readConfig((k) => client.storage.get(k));
	debugEnabled = client.storage.get("showGenre:debug") === "true";

	const updateGenres = async (): Promise<void> => {
		const token = ++updateToken;
		const item = client.player?.data?.item as { uri?: string; metadata?: Record<string, string> } | undefined;
		genlog("debug", "updateGenres triggered; item:", item?.uri ?? "(none)");
		if (!item?.uri || item.metadata?.is_local === "true") {
			genlog("debug", "no item or local file, clearing");
			clearGenres();
			return;
		}
		const type = (() => {
			try {
				return client.uri?.fromString(item.uri!)?.type;
			} catch {
				return undefined;
			}
		})();
		if (type !== "track") {
			genlog("debug", "not a track (type=", type, "), clearing");
			clearGenres();
			return;
		}

		const artist_name = item.metadata?.artist_name ?? "";
		const title = item.metadata?.title ?? "";
		if (!artist_name || !title) {
			genlog("debug", "missing artist/title metadata; artist=", artist_name, "title=", title);
			return;
		}
		genlog("debug", `looking up MusicBrainz for "${title}" by "${artist_name}"`);

		// Spotify's page CSP blocks direct cross-origin fetches, and the local
		// daemon's hop is refused by MusicBrainz, so route through the hosted
		// proxy via resolveMusicBrainzFetch.
		const outcome = await fetchGenresFromMusicBrainz(artist_name, title, resolveMusicBrainzFetch());
		if (token !== updateToken) return;
		genlog("debug", "MusicBrainz outcome:", outcome);
		if (!outcome.reachable) {
			genlog("warn", `MusicBrainz is unreachable from inside Spotify (${outcome.reason}).`);
			clearGenres();
			return;
		}
		if (outcome.genres.length === 0) {
			genlog("warn", "No genres found for the current track, removing genres from the UI...");
			clearGenres();
			return;
		}
		genlog("debug", "genres found:", outcome.genres);
		await injectGenres(outcome.genres, token);
	};

	await updateGenres();
	client.player?.addEventListener?.("songchange", updateGenres);

	ctx.defer(() => {
		client.player?.removeEventListener?.("songchange", updateGenres);
		clearGenres();
	});
}
