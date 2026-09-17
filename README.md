# Spotify Genres

See what genres you are listening to with this [Spicetify](https://spicetify.app/) module.

## Previews

Genres will be displayed below the author in current track information.

<img width="394" height="90" alt="image" src="https://github.com/user-attachments/assets/5c23ba9e-8e92-4b3b-9e0f-71a37501589e" />

If available, clicking on a genre will bring the Spotify-made playlist with related tracks of this specific genre.

<img width="1647" height="939" alt="image" src="https://github.com/user-attachments/assets/b048c96f-8929-4af2-83fe-8e84b0b3b4d3" />

## Requirements

A [Spicetify](https://github.com/spicetify/spicetify-cli) build with v3 module support.

## Install from Marketplace

Once the module is published to the store, you can install it from the Spicetify Marketplace, just search for "Better Spotify Genres" and click install.

## Install a build

If a packed build is attached to a release:

```bash
spicetify pkg install better-spotify-genres <url-to-zip>
```

## Development

Node.js 22.6 or newer and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev      # watch, rebuild and hot-push into a running client
pnpm check    # typecheck and audit against the module standard
pnpm test     # unit tests for logic.ts
pnpm build    # build into dist/
```

`pnpm dev` hot-pushes into a client started with `--remote-debugging-port=9229`; add `-- --launch` to let the kit start Spotify itself. To try a build without the dev loop:

```bash
pnpm build
pnpm exec spicetify-kit install dist/better-spotify-genres@0.1.0
```

The module follows the [module standard](https://github.com/spicetify/modules/blob/main/docs/module-standard.md); the [authoring guide](https://github.com/spicetify/modules/blob/main/docs/authoring-guide.md) covers the APIs.

## Credits

Forked from [Tetrax-10's Spotify-Genres](https://github.com/Tetrax-10/Spicetify-Extensions).
