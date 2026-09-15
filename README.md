![alt text](https://raw.githubusercontent.com/AlexPetrusca/Mephisto/master/res/mephisto_banner_lowercase.png)

Mephisto is a browser extension that enables next best move analysis and automated gameplay on Chess.com and Lichess.

## Getting Started

<a href="https://chrome.google.com/webstore/detail/mephisto-chess-extension/ihpdlpgcjepplokoncjelcbbcedgnanp" style="border: 1px solid white">
  <img src="https://github.com/AlexPetrusca/Mephisto/blob/master/res/chrome-web-store.png" align="center" height="66px" />
</a>
&nbsp;&nbsp;&nbsp;&nbsp;
<a href="https://addons.mozilla.org/en-US/firefox/addon/mephisto-chess-extension">
  <img src="https://github.com/AlexPetrusca/Mephisto/blob/master/res/firefox_web_store.png" align="center" height="66px" />
</a>
<br>
<br>

Click Mephisto's icon to open its popup window and automatically scrape the current page for a chess position to 
analyze. For ease of use, pin Mephisto in chrome's extensions menu. Click the puzzle icon to the right of Chrome's address bar. 
Find "Mephisto Chess Extension" and click the pin icon to the right of it.

You may notice that when you click outside of Mephisto's popup window, the popup will lose focus and close. To prevent
this, right-click the pinned icon and click 'Inspect Popup'. 

For more information, see [Getting Started](https://github.com/AlexPetrusca/Mephisto/wiki/Getting-Started).


## How to Develop Locally
The extension is written in TypeScript and built with esbuild, so it has to be
compiled before Chrome can load it. **Load `dist/`, not the repo root.**

Set up a local install:
1. Clone the repo
2. Run `npm install`
3. Run `npm run build` to produce `dist/`
4. Navigate to `chrome://extensions` through the Chrome address bar
5. Enable developer mode
6. Click on "Load unpacked" and select the `dist` folder
7. Mephisto Chess Extension is now installed

Test a code change:
1. Run `npm run watch` to rebuild on save (or `npm run build` once)
2. Navigate to `chrome://extensions`
3. Reload Mephisto Chess Extension
4. Reload the webpage you want to test on
5. Test the changes

Other scripts:
- `npm run typecheck` — run the TypeScript compiler with no output
- `npm run lint` — run ESLint
- `npm run check` — both of the above

Planned cleanup work is tracked in [`Plans/`](Plans/).

For technical details, see [Technical Overview](https://github.com/AlexPetrusca/Mephisto/wiki/Technical-Overview).


## How to Contribute
Thank you for your interest in contributing to Mephisto! There are many ways to contribute, and we appreciate all of them.

Ways to Contribute:
- Help contribute ideas to Mephisto
- Help identify and document bugs with Mephisto
- Implement requested features through PRs
- Fix identified bugs through PRs
