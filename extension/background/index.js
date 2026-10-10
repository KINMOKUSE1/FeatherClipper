/* 扩展后台入口；按依赖顺序加载各服务。 */
importScripts(
  "../shared/course.js",
  "settings.js",
  "bilibili.js",
  "youtube.js",
  "obsidian.js",
  "transcription.js",
  "courses.js",
  "quick-import.js"
);
