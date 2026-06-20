# Userscripts

A collection of Tampermonkey/Greasemonkey userscripts.

## Scripts

### [VideoZen](userscripts/VideoZen.user.js)

> Watch anything, your way — subtitles, gamma, zoom, and recording built in.

**Version:** 2.5 · **Matches:** `*://*/*`

Activate via the Tampermonkey menu command **▶ VideoZen** on any page that has a `<video>` element. The script wraps the longest video in a full-screen Video.js overlay and adds five control-bar plugins:

| Plugin | What it does |
|---|---|
| **Subtitles (SRT/VTT loader)** | Load a local `.srt` or `.vtt` file; includes a scrollable caption navigator panel. |
| **Gamma slider** | Hover the Γ button to reveal a vertical slider that brightens or darkens the video via an SVG `feComponentTransfer` filter. |
| **Zoom & Pan** | Toggle zoom mode, scroll to zoom (1×–5×), drag to pan, double-click to reset. |
| **Screenshot / Record** | Click for an instant PNG screenshot; hold (500 ms) to start recording — release to stop and preview/download the clip. |
| **Draw on frame** | Pauses the video and opens a canvas overlay with colour picker, brush size, eraser, clear, and save tools. |

#### Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or any compatible userscript manager).
2. Open [`userscripts/VideoZen.user.js`](userscripts/VideoZen.user.js) and click **Raw**, then confirm the installation prompt.

#### Usage

1. Navigate to any page with a video.
2. Open the Tampermonkey menu and click **▶ VideoZen**.
3. The video expands to fill the screen with the enhanced player.