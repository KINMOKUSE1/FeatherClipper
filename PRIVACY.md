# FeatherClipper Privacy Policy

Last updated: October 26, 2026

[简体中文](./PRIVACY.zh-CN.md)

This policy describes how the FeatherClipper browser extension for Microsoft Edge and its optional local transcription component handle information. FeatherClipper collects course materials from Bilibili and YouTube, exports or imports them into Obsidian, and prepares personalized rules and prompts for use with an AI tool chosen by the user.

## 1. Information used by the extension

| Information | Purpose |
| --- | --- |
| Video and course titles, instructor or uploader names, video identifiers and links, thumbnails, subtitles, timestamps, audio, and transcription results | Preview, collect, transcribe, export, and organize the course materials selected by the user |
| Obsidian Local REST API address and API key, transcription service API keys, and the local component connection code | Authenticate requests to the service for which each credential was supplied |
| Note structure, writing preferences, output paths, interface language, and task settings | Generate personalized note-taking rules and task instructions |
| Imported video links, titles, import times, material paths, and import status | Display course import history and allow users to continue importing a course |
| Local subtitle files, existing notes, and progress files selected by the user | Prepare the materials for a note-taking, continuation, translation, or supplementation task |
| Media request addresses and request bodies from an auxiliary YouTube playback tab created by the extension | Obtain the media session information needed for the current audio transcription task |

Course import history concerns the materials processed by the extension. The extension does not enumerate the browser's general browsing history or record general click, keystroke, mouse, or scrolling activity.

## 2. Requests and third-party services

- **Bilibili and YouTube:** The extension requests course information, subtitles, thumbnails, and audio from the platforms and their media services. Requests may use the user's existing platform login session where required. YouTube audio retrieval may create an auxiliary playback tab. These services receive the request information normally needed to deliver their content, such as the requesting IP address and request headers.
- **Obsidian:** When users test the connection, look up imported materials, or import content, the extension connects to the configured Local REST API on `localhost` or `127.0.0.1`. The Obsidian API key is sent to that local service, together with the file requests or content needed for the operation.
- **Local transcription:** The extension sends the selected media's identifiers, audio download addresses, and connection code to the local component on `127.0.0.1`. The component downloads the audio and performs recognition using a model on the user's computer. Installing its runtime, dependencies, and model requires requests to software and model download sources.
- **Online transcription:** If users select Groq or SiliconFlow and start a transcription task, the extension downloads and prepares the course audio, then sends audio segments, model parameters, and the selected provider's API key directly to that provider's HTTPS API. The provider returns transcription results. Its own policies govern its handling and retention of the submitted information: [Groq privacy policy](https://groq.com/privacy-policy) and [SiliconFlow privacy policy](https://api-docs.siliconflow.cn/docs/legals/privacy-policy).
- **AI note-taking tools:** The extension prepares rule files, task prompts, and material packages. Users decide whether to provide these to a local agent or upload them to a web AI service. The extension does not automatically submit these materials to a web AI service. The chosen tool's policies apply when users provide materials to it.

FeatherClipper does not send course materials or credentials to a developer-operated collection server. Credentials are used with their corresponding services; an Obsidian key is not sent to an online transcription provider.

## 3. Storage and retention

- Settings, credentials, note-taking preferences, import history, and course state are saved in browser-managed extension storage. Current save operations use local extension storage. For compatibility with earlier versions, the extension may read connection settings previously stored in browser sync storage and copy them into local storage; a previous sync copy may remain under the browser's sync controls.
- Browser-based online transcription uses temporary audio buffers and task results in memory. It does not create a persistent audio download in the user's Downloads folder. Temporary task data can remain until the task is released or the relevant extension context closes.
- The local component writes temporary audio into its data directory and attempts to remove the audio when the task finishes, fails, or is canceled. An interrupted process may leave temporary files. Its runtime, model, cache, and connection configuration remain on the computer for reuse.
- Task status and transcription results may remain in the running extension context or local service process until the task is cleared or that context or process closes.
- Exported Markdown, ZIP files, copied text, generated skill files, and content imported into Obsidian remain in the destinations chosen by the user. Removing an import-history entry does not delete those files.
- Information already sent to an external service is subject to that service's retention and deletion controls.

## 4. User choices and deletion

Users can:

- Choose the videos, subtitle language, files, transcription provider, and output destination used for a task.
- Stop a transcription task to cancel further processing and requests by the extension. Stopping does not retract information already submitted to a provider.
- Replace configured credentials and clear a saved online transcription API key through the audio transcription settings. Credentials can also be revoked or replaced at the service that issued them.
- Remove course records from the import-history page.
- Clear extension storage through the browser or uninstall the extension to remove its local browser data. Any earlier browser-sync copies are managed separately through the browser's sync controls.
- Delete exported files and Obsidian materials from their saved locations, and clear copied content from the clipboard or operating-system clipboard history as needed.
- Uninstall the local component separately. Its uninstaller retains `config.json`, which contains the connection code and configuration. Delete that retained file and any remaining component files to remove them completely.

## 5. Limits on use and sharing

Information is used to provide the course collection, transcription, import, export, and note-preparation features described above. FeatherClipper does not sell user data, use it for advertising or data brokering, use it for purposes unrelated to these features, or use it to determine creditworthiness or for lending purposes.

Transfers to the selected transcription service occur when users configure that service and initiate an online transcription task. Users can select local transcription for recognition on their computer, or stop using an online provider. The provider's data practices remain described in its own policy.

## 6. Credential and connection handling

Credentials are kept in browser-managed extension storage; the local component also stores its connection code in its local configuration file. Access to the user's browser profile and local configuration files is controlled by the device and browser.

Groq and SiliconFlow requests use HTTPS. Local Obsidian connections use HTTP or HTTPS according to the user's configuration; the local transcription component listens on the loopback address. When contacting support, share only the information needed to explain the issue and remove credentials and private course materials from public reports.

## 7. Policy updates

This policy will be updated when the extension's data handling changes. The date above identifies the latest revision, and the current policy is published with the project documentation.

## 8. Contact

For privacy questions or requests, contact the FeatherClipper maintainer through [GitHub Issues](https://github.com/KINMOKUSE1/FeatherClipper/issues) or the support contact listed on the Microsoft Edge Add-ons page. Use a private support channel for information that should not be posted publicly.
