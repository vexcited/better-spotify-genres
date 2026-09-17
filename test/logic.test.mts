import "./setup.mts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	addGenreRowToGridTemplate,
	removeGenreRowFromGridTemplate,
	camelize,
	defaultConfig,
	escapeHtml,
	escapeRegExp,
	isRejectedPlaylist,
	isSoundOfSpotifyPlaylist,
	prettifyGenre,
	readConfig,
	mergeAndWriteConfig,
} from "../logic.ts";

describe("camelize", () => {
	it("camel-cases and capitalizes a phrase", () => {
		assert.equal(camelize("rock and roll"), "RockAndRoll");
		assert.equal(camelize("electronic"), "Electronic");
	});

	it("strips non-alphanumeric separators", () => {
		assert.equal(camelize("indie-pop"), "IndiePop");
		assert.equal(camelize("  alt   rock "), "AltRock");
	});
});

describe("config persistence", () => {
	it("returns defaults when nothing is stored", () => {
		assert.deepEqual(readConfig(() => null), { cached: defaultConfig.cached });
	});

	it("falls back to defaults on malformed JSON", () => {
		assert.deepEqual(readConfig(() => "not json"), { cached: defaultConfig.cached });
	});

	it("merges stored cache over defaults", () => {
		const stored = JSON.stringify({ cached: { jazz: "spotify:playlist:abc" } });
		const config = readConfig(() => stored);
		assert.equal(config.cached.jazz, "spotify:playlist:abc");
		assert.equal(config.cached.pop, defaultConfig.cached.pop);
	});

	it("writes merged config through the set callback", () => {
		let written = "";
		const cfg = mergeAndWriteConfig(
			{ cached: { ...defaultConfig.cached }, },
			{ cached: { house: "spotify:playlist:xyz" } },
			(k, v) => {
				assert.equal(k, "showGenre:settings");
				written = v;
			},
		);
		assert.equal(cfg.cached.house, "spotify:playlist:xyz");
		assert.deepEqual((JSON.parse(written) as Record<string, unknown>).cached, cfg.cached);
	});
});

describe("playlist matching", () => {
	it("matches 'the sound of <genre>' case-insensitively", () => {
		assert.equal(isSoundOfSpotifyPlaylist("The Sound of Jazz", "jazz"), true);
		assert.equal(isSoundOfSpotifyPlaylist("the sound of ROCK", "rock"), true);
	});

	it("rejects unrelated names", () => {
		assert.equal(isSoundOfSpotifyPlaylist("Jazz Essentials", "jazz"), false);
	});

	it("escapes regex metacharacters in the genre", () => {
		assert.equal(escapeRegExp("a.b+c"), "a\\.b\\+c");
	});
});

describe("html escaping", () => {
	it("neutralizes markup in external genre names", () => {
		assert.equal(escapeHtml('rock & roll'), "rock &amp; roll");
		assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
		assert.equal(escapeHtml(`"'`), "&quot;&#39;");
	});
});

describe("rejected markers", () => {
	it("detects rejected playlists", () => {
		assert.equal(isRejectedPlaylist("spotify:playlist:abc|||"), true);
		assert.equal(isRejectedPlaylist("spotify:playlist:abc"), false);
	});
});

describe("genre labels", () => {
	it("prettifies genre labels", () => {
		assert.equal(prettifyGenre("rock and roll"), "Rock And Roll");
		assert.equal(prettifyGenre("hip-hop"), "Hip-Hop");
	});
});

describe("grid template manipulation", () => {
	const withQuality = '"trackArtists trackName trackName" "quality quality" / auto 1fr';
	const noQuality = '"trackArtists trackName trackName" / auto 1fr';

	it("adds a genres row before quality", () => {
		const out = addGenreRowToGridTemplate(withQuality);
		assert.match(out, /"genres genres" "quality quality"/);
	});

	it("appends a genres row when quality is absent", () => {
		const out = addGenreRowToGridTemplate(noQuality);
		assert.match(out, /trackName trackName" "genres genres"/);
	});

	it("is idempotent", () => {
		const once = addGenreRowToGridTemplate(withQuality);
		assert.equal(addGenreRowToGridTemplate(once), once);
	});

	it("removes the genres row it added", () => {
		const added = addGenreRowToGridTemplate(withQuality);
		const back = removeGenreRowFromGridTemplate(added);
		assert.equal(back, withQuality);
	});

	it("leaves a template without genres untouched", () => {
		assert.equal(removeGenreRowFromGridTemplate(withQuality), withQuality);
	});
});