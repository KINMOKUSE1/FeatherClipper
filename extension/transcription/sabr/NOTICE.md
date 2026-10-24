# SABR protocol dependency

- googlevideo: https://github.com/LuanRT/googlevideo/tree/96d1418984d00ac2797a1dafe4625d1368b5b9aa
- Source commit: `96d1418984d00ac2797a1dafe4625d1368b5b9aa` (MIT)
- Bundled wire runtime: @bufbuild/protobuf 2.16.0 (Apache-2.0 AND BSD-3-Clause)
- `vendor.js` is generated local code, loaded by the background worker and audio page; no remote scripts or eval are used
- Our session acquisition is in `background/youtube-audio.js`; download and duration validation are in `transcription/sabr/audio.js`

To rebuild, download the pinned source, install esbuild 0.28.2 and @bufbuild/protobuf 2.16.0 in a temporary directory, and bundle these exports as a browser IIFE named `FeatherClipperSabr`:

```js
export { SabrStream } from './src/exports/sabr-stream.ts';
export { VideoPlaybackAbrRequest, StreamProtectionStatus, UMPPartId } from './src/exports/protos.ts';
export { buildSabrFormat, EnabledTrackTypes, Logger, LogLevel } from './src/exports/utils.ts';
export { UmpReader } from './src/exports/ump.ts';
```

Include the licenses alongside the generated bundle.
