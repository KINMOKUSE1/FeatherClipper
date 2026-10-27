# Development guide

[简体中文](./开发指南.md) | English

The extension and development previews share the source in `extension/`. Pages load HTML, CSS, and JavaScript directly, with no compilation step.

## Development and previews

`dev/` provides preview entry points and mock APIs.

Run this from the project root:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

- [Popup](http://127.0.0.1:8000/dev/preview.html): switch between individual videos, course series, subtitle languages, unavailable subtitles, and save states
- [Workbench](http://127.0.0.1:8000/dev/workbench-preview.html): switch between course, connection, and import scenarios
- [Open the notes preview directly](http://127.0.0.1:8000/dev/workbench-preview.html?state=series&page=notes)

After editing, click **Refresh preview**. The preview loads the production pages from the current branch and mocks extension messages, storage, and materials; it does not write to Obsidian. Skill directory synchronization, clipboard access, and downloads still use the browser's actual capabilities.

To test the real extension, load `extension/` in Edge. After source changes, reload the extension and reopen its pages.

## User data and version updates

- `shared/preferences.js` provides a common `chrome.storage.local` interface for note preferences. On workbench startup, it migrates old `localStorage` preferences to extension storage and removes the old values only after a successful write. Existing extension storage values take precedence.
- Connection settings migrate values from the old `chrome.storage.sync` area when they are missing from `local`. Transcription settings, interface language, course snapshots, and import history continue to use extension local storage.
- The `key` in `manifest.json` is the public key that identifies the extension, not an API key. The fixed ID is `eopojhjechhkhfogcbicclmellbghbnc`. Preserve this value in subsequent versions rather than generating a new one.
- Releases updates overwrite the original directory and reload the existing extension. The same browser profile and extension ID continue using existing data. Keep the manifest's `key` in release ZIPs; user configuration files are not needed in the package.
- Test preference migration and skill delivery with `node --test tests/user-data.test.cjs tests/notes-delivery.test.cjs`. With Playwright installed, run `node tests/user-data-browser.cjs` to verify preference migration, note form saving, retained settings and records after an in-place version update, language switching, popup startup, and development previews in a temporary Edge profile. Set `FEATHERCLIPPER_BROWSER` to use another browser executable.

## Where to make changes

| What to change | Files |
|---|---|
| Popup layout, styling, and interactions | `extension/popup/index.html`, `style.css`, `page.js` |
| Workbench sidebar and page navigation | `extension/workbench/index.html`, `shell.css`, `shell.js` |
| Shared colors, basic controls, and icons | `extension/workbench/theme.css` |
| Cards, spacing, and footers on the three settings pages | `extension/workbench/settings.css` |
| Course catalog, subtitles, and import action bar | `extension/workbench/catalog/page.html`, `style.css`, `page.js` |
| Subtitle panel transition | `extension/workbench/catalog/preview.js` |
| Import button progress and state animations | `extension/workbench/catalog/import-button.js` |
| Obsidian connection settings | `extension/workbench/connection/page.html`, `page.js` |
| Local transcription page and queue | `extension/workbench/transcription/page.html`, `page.js` |
| Note configuration layout and editing | `extension/workbench/notes/page.html`, `style.css`, `page.js` |
| Notes page dropdowns and auto-sizing text fields | `extension/workbench/notes/controls.js` |
| Skill generation and task instructions | `extension/workbench/notes/generator.js` |
| Skill downloads, synchronization, copying, and web material export | `extension/workbench/notes/delivery.js`, `files.js` |
| Reading the actual materials for the current task | `extension/workbench/notes/materials.js` |
| Default note structure, properties, and preferences | `extension/workbench/notes/rules/defaults.js` |
| Skill entry point, workflow, and task methods | `extension/workbench/notes/rules/SKILL.md`, `workflow.md`, `tasks.md` |
| Course grouping, material paths, and Markdown generation | `extension/shared/course.js` |
| Dynamic button labels, states, messages, and counts | `extension/shared/ui-text.js` |
| Fonts and their declarations | `extension/shared/fonts.css`, `fonts/` |
| Preview examples and API responses | `dev/popup-preview-mock.js`, `workbench-preview-mock.js` |

## Editing interface text

Fixed titles and descriptions are marked with `data-i18n` in their HTML files. State-dependent button labels, messages, and counts live in `extension/shared/ui-text.js`, grouped by page. English and Traditional Chinese translations live in `extension/shared/locales/`. For example, when changing the source phrase `已导入 {count} 个课时` in `importButton.savedCount`, update both dictionaries' source keys and translations while keeping `{count}` intact; the page still supplies the count. Keep HTML source keys, displayed source text, and dictionary keys consistent, then refresh the preview.

Default module instructions, organization methods, and generated task content remain in `notes/rules/` and `notes/generator.js`. Original API error messages come from the API.

## Workbench responsibilities

`workbench/app.js` mounts the page fragments, creates controllers, and explicitly passes in messaging, navigation, feedback, and required interfaces. Each module uses a factory function to hold its own state.

- `shell.js` handles page navigation; `feedback.js` handles lightweight notifications.
- `catalog/page.js` manages the course, selected lessons, chapters, subtitle reading, and the ordinary import queue. Other pages read the current course through `getState()` and send course requests through `request()`.
- `connection/page.js` manages connection settings. `transcription/page.js` manages the local component connection and transcription queue, reusing catalog state and shared operations.
- `notes/page.js` manages the form and generated file preview. `materials.js` retrieves actual task materials. `generator.js` generates text from its inputs without accessing the DOM or APIs. `delivery.js` handles downloads, directory writes, and copying.

Each feature directory contains its page structure in `page.html`. Shared CSS defines common appearance, while feature-specific styles stay with the feature. Keep page business logic out of the entry script.

## Background and shared code

`background/index.js` is the extension's background entry point and loads services in dependency order. Browser pages call the background through `chrome.runtime.sendMessage`.

| File | Responsibility |
|---|---|
| `settings.js` | Read, validate, test, and save connection settings |
| `bilibili.js` | Bilibili metadata, subtitle tracks, and subtitle reading; dispatch platform subtitle requests |
| `youtube.js` | YouTube metadata, playlists, page audio tracks, and read scheduling |
| `youtube-subtitles.js` | Background HTTP subtitle requests, language selection, and timestamp parsing |
| `youtube-audio.js` | Muted helper pages, SABR session preparation, and playback validation |
| `obsidian.js` | Local REST requests and lookup of existing raw materials |
| `courses.js` | Course message entry point; coordinate reads, imports, and course index updates |
| `transcription.js` | Transcription engine configuration and routing of local and online jobs |
| `online-transcription.js` | Create the offscreen page for online jobs and route messages |
| `quick-import.js` | Background imports from the popup and persistent job state |

`shared/course.js` remains a pure course utility module shared by the popup, workbench, background, and tests. Fonts, icons, and licenses also have a single shared copy.

## YouTube subtitles

The service worker retrieves public client configuration from the watch HTML, calls the Android player API, and requests timedtext XML, without opening or operating a video page. It preserves Chinese-first and original-language track selection and parses the original start and end times. The three requests and preparation share an 8-second total budget; a timeout aborts the network requests.

Session rule `7002` removes Origin only from this extension's requests to the YouTube player API, preventing the API from rejecting the extension origin with 403. Bilibili media rule `7001` remains separate. An empty subtitle list is treated as no subtitles only when the player response matches the video ID and is playable. Request failures, verification restrictions, and empty subtitle text remain read failures.

A successful preview is reused only by the single import immediately following it. Refreshing or retrying makes a new request. Popup failures and no-subtitle results are passed to the workbench; manual retry sends a fresh request. Course metadata and playlist reading still use video pages, while audio transcription uses the SABR session flow below.

## YouTube SABR audio

For online transcription, `transcription/worker.js` first asks the background to prepare an audio source. `background/youtube-audio.js` creates a muted background helper page, observes that page's media requests through `webRequest`, and verifies that the requests belong to the current video. Once a candidate request is found, it reads `StreamProtectionStatus` from the UMP response and passes the session to the audio processing page only when the status is 1. HTTP 200 alone does not establish that the audio is usable.

`transcription/sabr/audio.js` uses the SABR URL already processed by the player, the PO token, Ustreamer configuration, and session context to download audio segments. After downloading, `transcription/audio.js` decodes the audio and checks its duration. A difference greater than 2 seconds stops processing without uploading partial audio. Once verified, the audio follows the existing upload flow: 16 kHz WAV in 120-second chunks.

Sessions exist only in memory for the current job. The helper page closes after the source is obtained; canceling during preparation also closes it. Canceling during download stops requests and stream reads. Transcription keys are passed only to the extension's internal audio processing page.

`transcription/sabr/vendor.js` is a pinned local protocol dependency. Its origin, exports, and rebuild instructions are in `NOTICE.md` in the same directory. Edit `youtube-audio.js` and `sabr/audio.js` when changing project logic; the generated dependency file does not need to change. The SABR route serves Groq and SiliconFlow. The local model still relies on the local component to download supported audio-track URLs.

Real validation should check the complete decoded duration before checking upload and cancellation behavior. `tests/youtube-sabr.test.cjs` covers protection states, partial audio, session isolation, and cancellation. Record success with simulated cloud responses separately from successful transcription through a real provider.

## A single source for note rules

General methods and user configuration are maintained separately. `rules/workflow.md` holds the complete organization workflow, `rules/tasks.md` defines task-specific methods, `rules/mermaid.md` holds diagram rules read when needed, and `rules/defaults.js` supplies editable module and property defaults.

The generator combines common rules and the current user configuration into nine files:

- `SKILL.md` and `agents/openai.yaml`
- `references/workflow.md` and `references/tasks.md`
- `references/mermaid.md` and `references/markdown.md`
- `references/preferences.md`, `references/modules.md`, and `references/properties.md`

The source `rules/` directory contains generator inputs; the generated `course-notes/` directory is the complete installable skill. Mermaid rules ship with the skill, and a separate diagram skill package is no longer maintained.

Local agents use the installed skill and actual material paths. Web AI uses exported text and rules. Both share the same organization rules and receive task instructions suited to their capabilities.

## Interface and output languages

The first popup visit opens a separate interface language selection page. After confirmation, the ordinary popup opens; later changes are made at the bottom left of the workbench sidebar. Both use `featherclipper:ui-locale`, independently of connection credentials, subtitle language, and note content language. The first visit follows the browser language. Manual choices are saved in extension local storage, and open pages synchronize through storage events.

| Interface | Generated descriptions, tasks, and skills | New default paths |
|---|---|---|
| Simplified Chinese | Simplified Chinese | Chinese |
| English | English | English |
| Traditional Chinese | English | English |

`shared/i18n.js` manages language selection, HTML markers, and known error templates. `shared/ui-text.js` retains the grouped dynamic text interface. Translations live in `shared/locales/en.js` and `zh-TW.js`. Dictionaries use Simplified Chinese source phrases as keys, with matching placeholders across languages. Mark HTML text with `data-i18n` and attributes with `data-i18n-placeholder`, `data-i18n-title`, or `data-i18n-aria-label`. For buttons with icons, mark only the text node. Apply translations after mounting page fragments.

The generator accepts an output language, and `notes/rules/en/` contains English versions of the original rules. Update the English version when changing a common rule. Unmodified built-in defaults in `defaults.js` follow the output language; handwritten content, original titles, subtitles, and saved note language are preserved. English and Traditional Chinese generate identical skill content, so switching between them does not invalidate installation confirmation.

English default paths include `Raw Subtitles/`, `Course Import Index.md`, `Note/Course Notes`, and `Notes Progress.md`. Web task packages use `rules/`, `materials/`, `existing-notes/`, and `Task.md`. Duplicate detection checks both old Chinese and English subtitle directories. Index links use actual saved paths, and existing files are not moved. The import queue fixes its output language when it starts.

Preview the first-run page with `dev/preview.html?setup=1`; ordinary previews continue to show the original popup. Add `locale=en` or `locale=zh-TW` to a preview URL, such as `dev/workbench-preview.html?state=series&page=notes&locale=en`. This affects only the preview iframe, which continues to share the production source and mock data.

## Validation and releases

```sh
node --test tests/*.test.cjs
```

Tests cover course grouping, subtitle reading, background messages, imports, task generation, file delivery, and page initialization. Check interface changes in the relevant preview scenarios. Real Obsidian connections, the extension environment, directory synchronization, and local transcription require tests of their actual workflows.

Run builds only when preparing a release. Development refactoring does not require updated installers or version numbers.

The local transcription installer is defined in `asr/installer.iss`, with runtime installation logic in `asr/setup-runtime.ps1`. Building requires Inno Setup 6.5+. Run `python scripts/build_asr_installer.py`, or specify `ISCC.exe` through `--iscc` or `INNO_SETUP_COMPILER`. The build produces `downloads/featherclipper-asr-setup.exe` and copies it to the extension's download entry point.
