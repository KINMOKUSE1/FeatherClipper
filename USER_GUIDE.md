# FeatherClipper · User guide

[简体中文](./使用说明.md) | English

## Installation and updates

### First installation

1. Download and extract the project source.
2. Open the extension manager in Chrome / Edge and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` directory in the source.
4. Pin FeatherClipper to the toolbar. Open a Bilibili or YouTube video and click the extension icon to get started.

Keep the loaded `extension/` directory in place; the browser reads the extension from it.

### Updating an existing installation

1. Download the new version from Releases, extract it, and overwrite the original `extension/` directory.
2. Click **Reload** on the existing FeatherClipper card in the extension manager, then reopen the extension pages.

Keep the existing extension installed during updates. Settings, note preferences, and import history are retained in the same browser profile. Uninstalling the extension clears this local data.

## Connecting to Obsidian

1. Open the target vault and install and enable the **Local REST API** community plugin.
2. Copy the server address and API key from its settings. The extension supports local `127.0.0.1` or `localhost` addresses only.
3. Open **Configure Obsidian** from the popup or course workbench and enter the address, key, and default material root folder.
4. Click **Test connection**, then save the settings after the test succeeds. Testing does not save them automatically.

The default example, `http://127.0.0.1:27123`, uses Local REST API's HTTP server, which must be enabled in the plugin. For HTTPS, complete the certificate setup described by Local REST API. Use the address and port shown in your plugin settings.

A saved key is not displayed again; saving with the field empty keeps the existing key. The material root folder is relative to the vault, for example `Clippings/Bilibili`. Manage these settings on the workbench's **Connections** page.

## Quickly importing the current video

1. Open a Bilibili or YouTube video and click the extension icon. The popup reads the current video and previews the first 12 reading paragraphs. Bilibili prefers Chinese by default; when multiple subtitle tracks are available, use the language selector beside the preview title. Saving and exporting use the selected track. YouTube reads the current transcript. Whole-course imports retrieve subtitles automatically and preserve their actual language information.
2. Confirm the video and destination folder, then click **Save subtitles** or **Save current subtitles**. The import saves all available subtitles and updates the course index.
3. Processing continues in the background after the popup closes. Reopen the popup on the same video to check the result. If the browser closes or the background process stops, the next visit prompts you to retry; already saved subtitles are skipped.
4. If subtitles are unavailable, click **Transcribe and import** and configure the audio component and engine in the course workbench. If reading fails, first confirm that the video plays normally in the browser.

Use the course workbench opened by the whole-course import action for multiple selections, chapter assignments, and note generation instructions.

To export only the current video, click the arrow beside the save button and choose **Copy to clipboard** or **Save file…**. Both export the full Markdown subtitles, including properties, source information, and timestamps. They are not limited to the first 12 preview paragraphs and do not require Obsidian. **Save file…** lets you choose the filename and location. Whole-course operations continue through the workbench.

## Course workbench: selecting and importing

1. Paste a Bilibili or YouTube video URL, or a Bilibili BV ID, and click **Read content**. Parts under the same Bilibili BV ID appear as a course catalog. A YouTube URL containing `list=` lists the playlist videos so you can select lectures to import.
2. Check chapter assignments. A numeric title such as `2.1.1_…` is grouped under `2.1`. Titles containing `Lecture` or `Lec` use the lecture number: `Lecture 02.1–02.4` all belong to `2`, and parts of the same lecture are grouped together. Chapter numbers can be edited; 0 means unassigned. Saved assignments are retained. Reimporting updates the index and skips existing subtitles. The lesson specified by the source URL is selected by default.
3. Click a part title to preview the first 100 subtitle entries on the right. Imports save all available subtitles. Timestamp links open the video at the corresponding point for checking.
4. To import a chapter, select it in the filter and click **Select chapter**. For the whole course, choose **All chapters** and click **Select all**. For the current part, click **Current only**; the current part follows the URL's `p` parameter, or P1 when no parameter is present.
5. Check the selection count and destination path at the bottom, then click **Import to Obsidian**.

You can switch tabs, but keep the import page open. Clicking the import button again during an import cancels subsequent processing after the current part finishes. Reading and importing the same course again skips existing files and continues with the remaining items. **Retry** processes only selected items marked as failed or missing subtitles; a retry may still return no result when subtitles remain unavailable. Expired login sessions, API rate limits, and Obsidian connection failures pause processing and show the reason.

For your first import, select one part and check its title, subtitles, and timestamp links in Obsidian before importing a batch.

## Optional audio transcription

The extension first uses subtitles provided by the platform. When none are available, the popup and workbench offer **Transcribe and import**. Groq and SiliconFlow run directly through the extension without a local component; only the local model requires a separate installation.

1. **Online mode**: choose Groq or SiliconFlow on the workbench's **Audio transcription** page, enter your API key, and click **Save configuration**. Saving neither uploads audio nor calls the transcription API.
2. **Local mode**: download and run `featherclipper-asr-setup.exe`, select CPU or NVIDIA GPU, start the component after installation, and copy its connection token into the workbench settings. The local model is approximately 461 MiB; GPU runtime libraries require approximately another 1.3 GiB.
3. Online mode hides the local component, connection token, and installation instructions. For local mode, installation instructions are hidden when the model is ready and remain visible while disconnected.
4. **Single part**: after the preview reports no subtitles, click **Transcribe and import**. **Whole course**: first import or preview the lessons to identify videos without subtitles, select them, and use **Transcribe and import** at the bottom. It processes only selected videos marked as having no subtitles; ordinary subtitles and existing raw materials are skipped.

In online mode, the extension downloads the audio track, decodes it in the browser, splits it into 120-second chunks, and uploads them directly to the selected provider. The audio file limit is 128 MiB. Results are written to Obsidian with the engine and model recorded. Groq provides segment timestamps; SiliconFlow saves plain text without timestamp navigation links. YouTube requires the player to provide a readable audio-track address.

Online API keys stay in the extension's local storage and are not included in notes or exported files. Rate limits trigger a wait before retrying; network timeouts are not automatically resent, to avoid duplicate calls. Clicking the import button again cancels the current browser request and subsequent chunks and videos. Requests already submitted may still be processed by the provider. Keep the workbench open during transcription; local mode also requires the component to remain running.

The online functionality is included in the source. Reload `extension/` to test it without updating or running the local component. The EXE and ZIP files remain the original release packages.

## File organization and duplicate imports

These examples use English output names. The corresponding Chinese names are `原始字幕/`, `课程导入清单.md`, and `整理进度.md`.

- **Raw materials**: `Clippings/Bilibili/Course title [BV ID]/Raw Subtitles/Part title [CID-number].md`. The CID suffix avoids collisions between parts with the same name. The older `CID-number.md` naming format is still recognized and is not automatically renamed.
- **YouTube raw materials**: `Clippings/YouTube/Video title [YT-videoID]/Raw Subtitles/Video title [YT-videoID].md`.
- **Chapter index**: `Course Import Index.md` in the same course directory.
- **Note preferences**: configured on the workbench's **Study notes** page and saved in the extension settings.
- **Final chapter notes**: saved by you and your AI according to the workflow; the extension does not generate them automatically.

Within the same course directory, materials are identified by CID. Reordering or renaming a part does not create a duplicate. If the publisher replaces a video and its CID changes, it is treated as new material. Existing raw files are not overwritten. Materials in other directories or using older naming schemes are not automatically migrated or deduplicated.

The extension updates `Course Import Index.md`. Keep your learning annotations in the final notes and save progress separately as `Notes Progress.md`. If an index with the same name was not generated by this tool, the import stops. Changing the material root folder or overall course title changes the course directory, so keep the destination consistent for a course.

## Turning subtitles into notes

1. After importing subtitles, select the lessons to organize and open **Study notes** in the workbench.
2. Enter your learning goal, notes folder, author name, language, grouping granularity, note structure, and properties, then save the settings. You can edit, reorder, add, or remove modules and change each property's filling rule on the right.
3. Choose the task: organize notes, supplement existing notes, continue organizing, translate subtitles, or review and Q&A. Supplement and continue tasks require existing notes or progress; review tasks require your current question.
4. For a **local agent**, install or synchronize the skill generated from the current configuration, confirm installation, and copy the short task instruction. It includes the selected scope and actual material paths. You can also supply paths to other local files that the agent can read.
5. For **web AI**, choose a material format and click **Export web materials**. Upload the exported text and rules, then copy the matching task instruction. You can additionally upload materials, existing notes, or progress. This workflow does not require an Obsidian connection.

Instructions limit the task to the selected parts. English courses use a lecture as the default unit: segments of the same lecture become one note, so `Lecture 02.1–02.4` becomes Lecture 02 with internal subheadings for each segment. Numeric chapters use one note per confirmed two-level chapter number: multiple parts under `2.2` are combined, while `2.3` becomes a separate note rather than merging everything into chapter `2`. Partial selections state the actual coverage. Explicit granularity in your personal rules takes precedence. After organizing, check the teacher's examples, derivations, and sources, then add your own understanding.

### Regular use: installing the skill

Select a local agent on **Study notes**, download the generated `course-notes.zip`, and install the entire skill folder, or select the skill directory to synchronize directly. The package contains nine files: the skill entry point, full workflow, task methods, Mermaid and Markdown writing rules, personal preferences, note structure, property rules, and agent metadata.

Downloading alone does not mark the skill as installed. After manual installation, confirm that the current configuration is installed in your agent. Directory synchronization writes and verifies the generated files before updating installation status. After changing rules, synchronize the skill before copying the task instruction. The file preview always shows the current generated content.

Mermaid diagram rules are included in the generated skill, so no separate diagram skill is needed.

## Supported scope

Supported sources include single and multiple parts under the same Bilibili BV ID, individual YouTube videos, and YouTube playlists. Bilibili collections spanning different BV IDs are not yet integrated. Chinese subtitles are preferred by default; English subtitles can also be selected. When subtitles are unavailable, local transcription can be attempted. Subtitles do not capture all visual information in a video.

This project is based on [Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) and retains the MIT license. The upstream project already supports AI-generated subtitles. This version adds course batch organization and removes peripheral features such as AI chat, reading mode, player modifications, comment collection, and subtitle downloading.
