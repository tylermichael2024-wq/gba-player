# Retro Player

Retro game players that run in the browser, built on [EmulatorJS](https://emulatorjs.org): NES, Game Boy / Game Boy Color, Game Boy Advance, Nintendo 64, Nintendo DS, PlayStation and PSP.

Open the site, choose a system, then load a game you own. It's stored only in your browser and never uploaded. Once you've loaded a game, opening that player starts it automatically.

- **P** pauses and opens a menu: save state, load state (3 slots each), resolution (Default, 1080p or 4K), load a different ROM, or go back to system select.
- **F1** switches 5x fast forward on and off.
- In-game saves and save states are kept in your browser, separately for each system.
- DS: click the bottom screen with your mouse to use the touch screen.
- PS1: use a `.chd` or `.pbp` file, or a `.zip` containing the game's `.cue` and `.bin` files.
- PSP: `.cso` files load fastest. Needs a recent computer and Chrome, Edge or Firefox (not Safari). The first visit reloads the page once while `coi-sw.js` sets up the multi-threading the PSP emulator needs.

## Files

| File | What it is |
| --- | --- |
| `index.html` | System select page |
| `nes.html`, `gbc.html`, `gba.html`, `n64.html`, `ds.html`, `ps1.html`, `psp.html` | One player page per system |
| `player.js`, `player.css` | Code and styling shared by all players |
| `coi-sw.js` | Helper for the PSP page (adds the headers multi-threading needs, since GitHub Pages can't) |

No games are included. You must supply your own legally obtained ROMs.
