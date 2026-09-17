/*
 * Client-free core: refraction of the classic "Better Spotify Genres"
 * extension from Vexcited/Tetrax-10. Everything here is pure enough to run
 * under node --test (no /modules/* or client global imports).
 */

const SETTINGS_KEY = "showGenre:settings";

const GENRE_GRID_AREA = '"genres genres"';
const QUALITY_GRID_AREA = '"quality quality"';

export interface CacheConfig {
	cached: Record<string, string>;
}

export const defaultConfig: CacheConfig = {
	cached: {
		pop: "spotify:playlist:6gS3HhOiI17QNojjPuPzqc",
	},
};

/** Capitalize the first character. */
export const capitalizeFirstLetter = (str: string): string => str.charAt(0).toUpperCase() + str.slice(1);

/** Camel-case a string (e.g. "rock and roll" -> "RockAndRoll") for the cache key. */
export const camelize = (str: string): string =>
	capitalizeFirstLetter(
		str
			.trim()
			.toLowerCase()
			.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()),
	);

/** Safely read the persisted config, defaulting on malformed JSON. */
export const readConfig = (get: (key: string) => string | null): CacheConfig => {
	try {
		const data = JSON.parse(get(SETTINGS_KEY) ?? "{}") as { cached?: Record<string, string> };
		return { cached: { ...defaultConfig.cached, ...data.cached } };
	} catch {
		return { cached: { ...defaultConfig.cached } };
	}
};

/** Persist the config, guaranteed to include defaults for any missing key. */
export const mergeAndWriteConfig = (
	current: CacheConfig,
	patch: Partial<CacheConfig>,
	set: (key: string, value: string) => void,
): CacheConfig => {
	const merged: CacheConfig = {
		cached: { ...defaultConfig.cached, ...current.cached, ...patch.cached },
	};
	set(SETTINGS_KEY, JSON.stringify(merged));
	return merged;
};

/** A playlist URI whose owner was rejected stays a non-navigable stub. */
const REJECTED_MARKER = "|||";

export interface GenrePlaylist {
	uri: string | null;
	genre: string;
}

/** Escape a string for use in a RegExp literal. */
export const escapeRegExp = (input: string): string => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Escape text before interpolating it into the genres `innerHTML`. Genre names
 * come from the MusicBrainz API (third-party, user-editable tags), so they must
 * not be able to inject markup.
 */
export const escapeHtml = (input: string): string =>
	input.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
	);

/** Case-insensitive exact match for "the sound of <genre>" (Spotify's curated playlists). */
export const isSoundOfSpotifyPlaylist = (name: string, genre: string): boolean =>
	new RegExp(`^the sound of ${escapeRegExp(genre)}$`, "i").test(name);

/** Guard against a stale/corrupted cached URI from an older build. */
export const isRejectedPlaylist = (uri: string): boolean => uri.includes(REJECTED_MARKER);

/** Title-case a genre label for display ("rock and roll" -> "Rock And Roll"). */
export const prettifyGenre = (genre: string): string => genre.replace(/(^\w{1})|([\s-]+\w{1})/g, (c) => c.toUpperCase());

/**
 * Inject a `genres` row into the now-playing info container's CSS grid.
 * Pure over a template string so it is unit-testable without the DOM.
 *
 * Inserting before the `quality` row keeps enabled genres above the
 * "explicit/quality" badge row; if quality is absent it appends at the end.
 */
export function addGenreRowToGridTemplate(template: string): string {
	const [areas, properties] = template.split("/").map((s) => s.trim());
	const edited = areas.includes(GENRE_GRID_AREA) ? areas : areas.includes(QUALITY_GRID_AREA)
		? areas.replace(QUALITY_GRID_AREA, `${GENRE_GRID_AREA} ${QUALITY_GRID_AREA}`)
		: `${areas} ${GENRE_GRID_AREA}`;
	return `${edited} / ${properties}`;
}

/** Remove the `genres` row we added, restoring the client's original grid. */
export function removeGenreRowFromGridTemplate(template: string): string {
	if (!template.includes(GENRE_GRID_AREA)) return template;
	const [areas, properties] = template.split("/").map((s) => s.trim());
	return `${areas.replace(GENRE_GRID_AREA, "").trim().replace(/\s{2,}/g, " ")} / ${properties}`;
}

/**
 * Result of a single MusicBrainz fetch attempt. Distinguishes a request that
 * reached the API (even with no matches) from one that was blocked or failed,
 * so the caller can log the real reason instead of silently clearing the UI.
 */
export interface GenreFetchOutcome {
	genres: string[];
	/** False when we could not reach MusicBrainz (network/CORS/blocked). */
	reachable: boolean;
	reason?: string;
}

/**
 * MusicBrainz asks callers to identify themselves. Browsers refuse to let
 * scripts set `User-Agent` (forbidden header), so this is only observed by
 * non-browser callers such as the unit tests; in-page requests go through the
 * CORS proxy, which identifies itself.
 */
const MUSICBRAINZ_UA = "spicetify-v3/better-spotify-genres (https://spicetify.app)";

/**
 * Fetch genre tags for a recording from the MusicBrainz public API. Returns a
 * structured outcome so callers can tell "reached the API, but no tags exist"
 * apart from "the API could not be reached from inside Spotify".
 */
export async function fetchGenresFromMusicBrainz(
	artistName: string,
	trackName: string,
	fetchImpl: typeof fetch = fetch,
): Promise<GenreFetchOutcome> {
	// MusicBrainz rate-limits public requests and can answer transient 503s or
	// drop the connection; retry briefly so a momentary hiccup is not read as
	// "this track has no genres" (which would clear the UI).
	const fetchJson = async (url: URL): Promise<Record<string, unknown> | null> => {
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await fetchImpl(url, { headers: { "User-Agent": MUSICBRAINZ_UA } });
				if (res.ok) return (await res.json()) as Record<string, unknown>;
			} catch {
				// transient connection failure; retry
			}
			await new Promise((r) => setTimeout(r, 300));
		}
		return null;
	};

	const searchUrl = new URL("https://musicbrainz.org/ws/2/recording?fmt=json&limit=1");
	searchUrl.searchParams.set("query", `recording:"${trackName}" AND artist:"${artistName}"`);

	const search = await fetchJson(searchUrl);
	if (search === null) {
		return { genres: [], reachable: false, reason: "Search request to MusicBrainz failed (network blocked, CORS, or rate-limited)." };
	}
	const first = (search.recordings as Array<{ id?: string }> | undefined)?.[0];
	if (!first?.id) {
		return { genres: [], reachable: true, reason: "No MusicBrainz recording matched the query." };
	}

	const detailUrl = new URL(`https://musicbrainz.org/ws/2/recording/${first.id}?inc=tags+artists&fmt=json`);
	const recording = await fetchJson(detailUrl);
	if (recording === null) {
		return { genres: [], reachable: false, reason: "Recording detail request to MusicBrainz failed (network blocked, CORS, or rate-limited)." };
	}

	const tags = (recording.tags as Array<{ name: string }> | undefined) ?? [];
	if (tags.length) return { genres: tags.map((tag) => tag.name), reachable: true };
	const artistCredit = (recording as Record<string, unknown>)["artist-credit"] as
		Array<{ artist?: { tags?: Array<{ name: string }> } }> | undefined;
	const artistTags = artistCredit?.[0]?.artist?.tags ?? [];
	return { genres: artistTags.map((tag) => tag.name), reachable: true };
}