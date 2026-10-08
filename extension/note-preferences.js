/* User-editable note preferences. The fixed writing method stays in course-notes. */
(() => {
  const form = document.getElementById("note-preferences-form");
  const storageKey = "boc-note-preferences:v1";
  const field = name => document.getElementById(`note-${name}`);
  const properties = field("properties");
  const types = { text: "文字", number: "数字", list: "列表", boolean: "开关", date: "日期" };
  let loaded = false;

  function addProperty(property = { name: "", type: "text", value: "" }) {
    const row = document.createElement("div");
    row.className = "note-property-row";
    const name = document.createElement("input");
    name.className = "property-name"; name.placeholder = "属性名"; name.value = property.name;
    name.setAttribute("aria-label", "自定义属性名称");
    const type = document.createElement("select");
    type.className = "property-type"; type.setAttribute("aria-label", "自定义属性类型");
    for (const [value, label] of Object.entries(types)) type.add(new Option(label, value));
    type.value = property.type;
    const typeControl = document.createElement("div");
    typeControl.className = "property-type-control";
    const typeIcon = document.createElement("span");
    typeIcon.className = "icon property-type-icon"; typeIcon.setAttribute("aria-hidden", "true");
    typeControl.append(typeIcon, type);
    const valueContainer = document.createElement("div");
    valueContainer.className = "property-value-container";
    function setValue(value = "") {
      row.dataset.type = type.value;
      type.title = `属性类型：${types[type.value]}`;
      const control = type.value === "boolean" ? document.createElement("select") : document.createElement("input");
      control.className = "property-value";
      control.setAttribute("aria-label", "自定义属性值");
      if (type.value === "boolean") {
        control.add(new Option("否", "false")); control.add(new Option("是", "true"));
        control.value = String(value === true || value === "true");
      } else {
        control.type = type.value === "number" ? "number" : type.value === "date" ? "date" : "text";
        if (type.value === "number") control.step = "any";
        control.placeholder = type.value === "list" ? "逗号分隔" : "属性值";
        control.value = Array.isArray(value) ? value.join(", ") : value;
      }
      valueContainer.replaceChildren(control);
    }
    setValue(property.value);
    type.addEventListener("change", () => setValue());
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "text-button property-remove"; remove.textContent = "×";
    remove.setAttribute("aria-label", "删除此属性");
    remove.addEventListener("click", () => { row.remove(); document.getElementById("add-note-property").focus(); });
    row.append(typeControl, name, valueContainer, remove);
    properties.append(row);
    return name;
  }

  function fill(p) {
    for (const name of ["goal", "language", "author", "granularity", "naming", "instructions"]) field(name).value = p[name];
    field("output-folder").value = p.outputFolder;
    field("tags").value = p.tags.join(", ");
    field("sections").value = p.sections.join("\n");
    field("external-sources").checked = p.externalSources;
    properties.replaceChildren();
    for (const property of p.properties) addProperty(property);
  }

  function read() {
    return CourseCore.normalizeStudyPreferences({
      goal: field("goal").value, language: field("language").value, author: field("author").value,
      granularity: field("granularity").value, naming: field("naming").value, instructions: field("instructions").value,
      outputFolder: field("output-folder").value, tags: field("tags").value, sections: field("sections").value,
      externalSources: field("external-sources").checked,
      properties: [...properties.children].map(row => ({
        name: row.querySelector(".property-name").value, type: row.querySelector(".property-type").value,
        value: row.querySelector(".property-value").value
      }))
    });
  }

  async function load() {
    if (loaded) return;
    const saved = (await chrome.storage.local.get(storageKey))[storageKey];
    fill(CourseCore.normalizeStudyPreferences(saved));
    loaded = true;
  }

  async function save() {
    if (!form.reportValidity()) throw new Error("请检查偏好中未填写或无效的内容。");
    const preferences = read();
    await chrome.storage.local.set({ [storageKey]: preferences });
    return preferences;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("save-note-preferences");
    button.disabled = true;
    try {
      await save();
      showSettingsFeedback("note-status", "偏好已保存，之后的任务指令会使用这些设置");
    } catch (error) { showSettingsFeedback("note-status", error.message); }
    finally { button.disabled = false; }
  });
  document.getElementById("add-note-property").addEventListener("click", () => addProperty().focus());
  window.NotePreferences = { load, save };
})();
