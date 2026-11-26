# WeChat Canvas and Lua Runtime

JavaScript utilities for a WeChat Mini Game Canvas 2D host and embedded Lua scripting. The host supplies the canvas, optional asset mappings and font names, and the Lua code it chooses to execute.

## Distribution files

- `lib/canvas-bridge.js` adapts path commands, text layout, and pixel sprites to Canvas 2D. Its sprite atlas reuses pre-rendered tiles and falls back to direct drawing if an offscreen canvas is unavailable.
- `lib/fengari-runtime.js` bundles selected Fengari 0.1.5 APIs for a JavaScript host. Its entry point is `src/fengari-runtime.js`. The bundle exposes the Lua API, auxiliary API, and portable standard libraries.
- `lib/sprintf.js` is the upstream 1.1.3 JavaScript source that Fengari uses for Lua string formatting.

Use CommonJS to import the two entry points from the same `lib` directory.

```js
const { createCanvasBridge } = require('./lib/canvas-bridge.js');
const { lua, aux } = require('./lib/fengari-runtime.js');

const canvas = wx.createCanvas();
const drawing = createCanvasBridge(wx, canvas, canvas.getContext('2d'), {}, {});
const state = aux.luaL_newstate();
drawing.begin(1, 1, true);
drawing.commands.FillRect(0, 0, 24, 24, '#3388ff');
lua.lua_close(state);
```

## Upstream projects

- Fengari 0.1.5, MIT. [Repository](https://github.com/fengari-lua/fengari) · [GitHub Release](https://github.com/fengari-lua/fengari/releases/tag/v0.1.5)
- sprintf-js 1.1.3, BSD-3-Clause. [Repository](https://github.com/alexei/sprintf.js) · [Upstream version tag](https://github.com/alexei/sprintf.js/tree/1.1.3)

The Canvas adapter and runtime entry point are MIT licensed. The distribution retains the original license notices for Fengari and sprintf-js.
