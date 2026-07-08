function h(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key === "class") element.className = value;
    else if (key === "dataset") Object.assign(element.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "html") {
      element.innerHTML = value;
    } else {
      element.setAttribute(key, String(value));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null) continue;
    element.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return element;
}

function field(id, label, input, hint) {
  return h("label", { class: "field", for: id }, [
    h("span", { class: "field-label" }, label),
    input,
    hint ? h("span", { class: "field-hint" }, hint) : null
  ]);
}

function labelWithInfo(label, info) {
  return h("span", { class: "label-with-info" }, [
    h("span", {}, label),
    h("span", { class: "info-icon", tabindex: "0", "aria-label": info }, [
      "i",
      h("span", { class: "tooltip", role: "tooltip" }, info)
    ])
  ]);
}

function button(label, options = {}) {
  return h(
    "button",
    {
      class: `button ${options.variant || ""}`.trim(),
      type: options.type || "button",
      disabled: options.disabled,
      title: options.title,
      onclick: options.onclick
    },
    label
  );
}

function segmented(name, values, selected, onChange) {
  return h("div", { class: "segmented", role: "radiogroup", "aria-label": name, style: `--count: ${values.length}` }, [
    ...values.map((value) =>
      h(
        "button",
        {
          class: selected === value ? "selected" : "",
          type: "button",
          role: "radio",
          "aria-checked": selected === value,
          onclick: () => onChange(value)
        },
        value
      )
    ),
    h("span", { class: "segmented-indicator", style: `--index: ${Math.max(values.indexOf(selected), 0)}` })
  ]);
}

export { button, field, h, labelWithInfo, segmented };
