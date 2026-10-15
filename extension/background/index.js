/* 扩展后台入口；按依赖顺序加载各服务。 */
importScripts(
  "../shared/course.js",
  "../shared/import-history.js",
  "settings.js",
  "wbi.js",
  "bilibili.js",
  "youtube.js",
  "video-navigation.js",
  "obsidian.js",
  "transcription.js",
  "history.js",
  "courses.js",
  "quick-import.js"
);
