/* 工作台轻提示和设置页反馈；不处理导入或连接业务。 */
window.createWorkbenchFeedback = function ({ isBusy }) {
  function status(text, error = false) {
    const sourceOpen = document.getElementById("source-dialog").open;
    document.getElementById("source-status").textContent = sourceOpen ? text : "";
    document.getElementById("source-status").classList.toggle("error", error);
    if (text && !sourceOpen && !isBusy()) showToast(text, error);
  }
  const importToast = document.getElementById("import-toast");
  let toastTimer;
  function showToast(text, error = false) {
    clearTimeout(toastTimer);
    importToast.textContent = text;
    importToast.classList.toggle("error", error);
    importToast.hidden = false;
    requestAnimationFrame(() => {
      const bar = document.querySelector(".import-bar");
      const barRect = bar.getBoundingClientRect();
      const courseHidden = document.getElementById("course").hidden;
      const aboveBar = courseHidden ? 24 : window.innerHeight - barRect.top + 12;
      importToast.style.left = `${courseHidden ? 24 : barRect.left}px`;
      importToast.style.bottom = `${Math.max(24, aboveBar)}px`;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        importToast.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 180, easing: "ease-out" });
      }
    });
    toastTimer = setTimeout(() => { importToast.hidden = true; importToast.textContent = ""; }, 5000);
  }
  const settingsFeedbackTimers = new Map();
  function dismissSettingsFeedback(message) {
    clearTimeout(settingsFeedbackTimers.get(message.id));
    settingsFeedbackTimers.delete(message.id);
    message.closest(".settings-feedback").hidden = true;
  }
  function showSettingsFeedback(id, text) {
    const message = document.getElementById(id);
    dismissSettingsFeedback(message);
    message.textContent = text.replace(/。/g, "");
    if (!message.textContent.trim()) return;
    message.closest(".settings-feedback").hidden = false;
    settingsFeedbackTimers.set(id, setTimeout(() => dismissSettingsFeedback(message), 4000));
  }
  for (const feedback of document.querySelectorAll(".settings-feedback")) {
    const message = feedback.querySelector('[role="status"]');
    feedback.querySelector(".settings-feedback-close").addEventListener("click", () => dismissSettingsFeedback(message));
  }
  return { status, settings: showSettingsFeedback };
};
