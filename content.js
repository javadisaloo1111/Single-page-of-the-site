(() => {
  if (window.__VOCATYPE_CONTENT_READY__) return;
  Object.defineProperty(window, "__VOCATYPE_CONTENT_READY__", { value: true, configurable: false });

  const EXTENSION_ID = chrome.runtime.id;
  let settings = null;
  let lastEditable = null;
  let selectionSnapshot = null;
  let lastInsertedSnapshot = null;
  let floatingHost = null;
  let floatingRoot = null;
  let floatingText = null;
  let floatingState = null;
  let dragState = null;
  let positionSaveTimer = null;
  let hideTimer = null;
  let lastDictation = null;
  const undoStack = [];
  const redoStack = [];
  const sessionSnapshots = new Map();
  const MAX_SNAPSHOT_CHARS = 120000;

  function isTextInput(element) {
    if (!(element instanceof HTMLInputElement)) return false;
    return ["text", "search", "url", "tel", "email", "number"].includes((element.type || "text").toLowerCase());
  }

  function isEditable(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
    if (isTextInput(element)) return !element.disabled && !element.readOnly;
    if (element.isContentEditable) return true;
    const role = element.getAttribute("role");
    return role === "textbox" && element.getAttribute("aria-readonly") !== "true" && (element.getAttribute("aria-multiline") === "true" || element.isContentEditable);
  }

  function closestEditable(element) {
    if (!(element instanceof Element)) return null;
    let current = element;
    while (current && current !== document.documentElement) {
      if (isEditable(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function captureSelection(element = lastEditable) {
    if (!isEditable(element)) return null;
    lastEditable = element;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      let start = element.value.length;
      let end = start;
      try {
        start = element.selectionStart ?? start;
        end = element.selectionEnd ?? start;
      } catch { /* input type may not expose selection */ }
      selectionSnapshot = { element, start, end, kind: "control" };
      return selectionSnapshot;
    }
    const selection = document.getSelection();
    let range = null;
    if (selection?.rangeCount) {
      const candidate = selection.getRangeAt(0);
      if (element.contains(candidate.commonAncestorContainer) || candidate.commonAncestorContainer === element) range = candidate.cloneRange();
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
    }
    selectionSnapshot = { element, range, kind: "editable" };
    return selectionSnapshot;
  }

  function rememberFocused(event) {
    const editable = closestEditable(event.target);
    if (editable) {
      lastInsertedSnapshot = null;
      captureSelection(editable);
    }
  }

  document.addEventListener("focusin", rememberFocused, true);
  document.addEventListener("mouseup", () => {
    const editable = closestEditable(document.activeElement) || lastEditable;
    if (editable) {
      lastInsertedSnapshot = null;
      captureSelection(editable);
    }
  }, true);
  document.addEventListener("keyup", (event) => {
    const editable = closestEditable(event.target) || closestEditable(document.activeElement);
    if (editable) {
      lastInsertedSnapshot = null;
      captureSelection(editable);
    }
  }, true);
  document.addEventListener("selectionchange", () => {
    const active = closestEditable(document.activeElement);
    if (active) captureSelection(active);
    else if (selectionSnapshot?.element?.isConnected && isEditable(selectionSnapshot.element)) {
      // Keep the last usable selection while an extension popup temporarily owns focus.
    }
  });

  function selectionForInsert() {
    const active = closestEditable(document.activeElement);
    const lastInserted = lastInsertedSnapshot;
    if (lastInserted?.element?.isConnected && isEditable(lastInserted.element)
      && (!active || active === lastInserted.element || active === floatingHost)
      && getValueSnapshot(lastInserted.element) === lastInserted.after) {
      return lastInserted.kind === "control"
        ? { ...lastInserted }
        : { ...lastInserted, range: lastInserted.range?.cloneRange() || null };
    }
    if (active && active !== floatingHost) return captureSelection(active);
    if (selectionSnapshot?.element?.isConnected && isEditable(selectionSnapshot.element)) return selectionSnapshot;
    if (lastEditable?.isConnected && isEditable(lastEditable)) return captureSelection(lastEditable);
    return null;
  }

  function getValueSnapshot(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
    return element.innerHTML;
  }

  function dispatchInput(element, text, inputType = "insertText") {
    try {
      element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType, data: text }));
    } catch {
      element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setControlValue(element, value, inputType = "deleteContent") {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    const cursor = Math.min(value.length, element.selectionStart ?? value.length);
    try { element.setSelectionRange(cursor, cursor); } catch { /* unsupported input type */ }
    dispatchInput(element, value, inputType);
    captureSelection(element);
  }

  function saveSnapshot(element, before, after, insertedText, trackForCopy = true) {
    const inserted = String(insertedText || "");
    if (trackForCopy) lastDictation = { element, after, insertedText: inserted };
    else if (lastDictation?.element === element) lastDictation.after = after;
    // Avoid retaining very large editor documents for undo/history snapshots.
    if (before.length + after.length > MAX_SNAPSHOT_CHARS) {
      undoStack.length = 0;
      redoStack.length = 0;
      sessionSnapshots.delete(element);
      return;
    }
    const snapshot = { element, before, after, insertedText: inserted, trackForCopy, time: Date.now() };
    undoStack.push(snapshot);
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
    const session = sessionSnapshots.get(element);
    if (session) session.after = after;
    else {
      if (sessionSnapshots.size >= 12) sessionSnapshots.delete(sessionSnapshots.keys().next().value);
      sessionSnapshots.set(element, { before, after });
    }
  }

  function insertControl(element, text, snapshot, trackForCopy) {
    const before = element.value;
    let start = snapshot?.element === element ? snapshot.start : element.value.length;
    let end = snapshot?.element === element ? snapshot.end : start;
    start = Math.max(0, Math.min(before.length, Number.isInteger(start) ? start : before.length));
    end = Math.max(start, Math.min(before.length, Number.isInteger(end) ? end : start));
    let inserted = text;
    if (element instanceof HTMLInputElement && /[\r\n]/.test(inserted)) inserted = inserted.replace(/[\r\n]+/g, " ");
    try {
      element.setRangeText(inserted, start, end, "end");
    } catch {
      const updated = before.slice(0, start) + inserted + before.slice(end);
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, updated); else element.value = updated;
      try { element.setSelectionRange(start + inserted.length, start + inserted.length); } catch { /* type does not support selection */ }
    }
    dispatchInput(element, inserted, "insertText");
    const after = element.value;
    const cursor = Math.max(0, Math.min(after.length, start + inserted.length));
    try { element.setSelectionRange(cursor, cursor); } catch { /* unsupported input type */ }
    selectionSnapshot = { element, start: cursor, end: cursor, kind: "control" };
    lastInsertedSnapshot = { element, start: cursor, end: cursor, after, kind: "control" };
    lastEditable = element;
    saveSnapshot(element, before, after, inserted, trackForCopy);
    return { ok: true, insertedText: inserted };
  }

  function insertContentEditable(element, text, snapshot, trackForCopy) {
    const before = element.innerHTML;
    let range = snapshot?.element === element && snapshot.range ? snapshot.range.cloneRange() : null;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
    }
    if (!element.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== element) {
      range.selectNodeContents(element);
      range.collapse(false);
    }
    const inputEvent = (() => {
      try { return new InputEvent("beforeinput", { bubbles: true, composed: true, cancelable: true, inputType: "insertText", data: text }); }
      catch { return new Event("beforeinput", { bubbles: true, composed: true, cancelable: true }); }
    })();
    element.dispatchEvent(inputEvent);
    const currentSelection = document.getSelection();
    currentSelection?.removeAllRanges();
    currentSelection?.addRange(range);
    let usedEditorCommand = false;
    try { usedEditorCommand = document.execCommand("insertText", false, text); } catch { /* use range fallback */ }
    if (!usedEditorCommand) {
      const selection = document.getSelection();
      let insertRange = selection?.rangeCount ? selection.getRangeAt(0) : range;
      if (!element.contains(insertRange.commonAncestorContainer) && insertRange.commonAncestorContainer !== element) insertRange = range;
      insertRange.deleteContents();
      const fragment = document.createDocumentFragment();
      let lastNode = null;
      String(text).split("\n").forEach((line, index) => {
        if (index > 0) {
          lastNode = document.createElement("br");
          fragment.append(lastNode);
        }
        if (line) {
          lastNode = document.createTextNode(line);
          fragment.append(lastNode);
        }
      });
      if (lastNode) insertRange.insertNode(fragment);
      if (lastNode) insertRange.setStartAfter(lastNode);
      insertRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(insertRange);
      dispatchInput(element, text, "insertText");
    }
    const after = element.innerHTML;
    captureSelection(element);
    lastInsertedSnapshot = {
      element,
      range: selectionSnapshot?.element === element ? selectionSnapshot.range?.cloneRange() || null : null,
      after,
      kind: "editable"
    };
    saveSnapshot(element, before, after, text, trackForCopy);
    return { ok: true, insertedText: text };
  }

  function insertText(text, { trackForCopy = true } = {}) {
    const value = String(text ?? "");
    if (!value) return { ok: true, inserted: false };
    const snapshot = selectionForInsert();
    if (!snapshot || !isEditable(snapshot.element)) return { ok: false, error: "برای درج متن، ابتدا یک فیلد متنی را انتخاب کنید." };
    const element = snapshot.element;
    try {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return insertControl(element, value, snapshot, trackForCopy);
      return insertContentEditable(element, value, snapshot, trackForCopy);
    } catch {
      return { ok: false, error: "این ویرایشگر اجازهٔ درج متن را نداد. در یک فیلد معمولی دوباره امتحان کنید." };
    }
  }

  function restoreSnapshot(snapshot, value, inputType) {
    const element = snapshot?.element;
    if (!element?.isConnected || !isEditable(element)) return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setControlValue(element, value, inputType);
      return true;
    }
    element.innerHTML = value;
    dispatchInput(element, "", inputType);
    captureSelection(element);
    return true;
  }

  function undoLast() {
    const record = undoStack.pop();
    if (!record) return { ok: false, error: "متنی برای واگردانی پیدا نشد." };
    const element = record.element;
    if (!element?.isConnected || getValueSnapshot(element) !== record.after) {
      undoStack.push(record);
      return { ok: false, error: "متن بعد از دیکته تغییر کرده است؛ برای جلوگیری از حذف متن شما، واگردانی انجام نشد." };
    }
    restoreSnapshot(record, record.before, "historyUndo");
    redoStack.push(record);
    if (record.trackForCopy) lastDictation = [...undoStack].reverse().find((item) => item.trackForCopy) || null;
    else if (lastDictation?.element === element && lastDictation.after === record.after) lastDictation.after = record.before;
    const session = sessionSnapshots.get(element);
    if (session) session.after = record.before;
    return { ok: true };
  }

  function redoLast() {
    const record = redoStack.pop();
    if (!record) return { ok: false, error: "متنی برای انجام دوباره پیدا نشد." };
    const element = record.element;
    if (!element?.isConnected || getValueSnapshot(element) !== record.before) {
      redoStack.push(record);
      return { ok: false, error: "فیلد از آخرین واگردانی تغییر کرده است؛ انجام دوباره لغو شد." };
    }
    restoreSnapshot(record, record.after, "historyRedo");
    undoStack.push(record);
    if (record.trackForCopy) lastDictation = record;
    else if (lastDictation?.element === element && lastDictation.after === record.before) lastDictation.after = record.after;
    const session = sessionSnapshots.get(element);
    if (session) session.after = record.after;
    return { ok: true };
  }

  function clearLastDictation() {
    return undoLast();
  }

  function clearSessionDictation() {
    let cleared = 0;
    for (const [element, record] of sessionSnapshots.entries()) {
      if (!element?.isConnected || getValueSnapshot(element) !== record.after) continue;
      if (restoreSnapshot({ element }, record.before, "deleteContent")) cleared++;
    }
    if (!cleared) return { ok: false, error: "متن دیکته‌شده پیدا نشد یا فیلد بعد از دیکته تغییر کرده است." };
    undoStack.length = 0;
    redoStack.length = 0;
    sessionSnapshots.clear();
    lastDictation = null;
    return { ok: true };
  }

  function getCopyText() {
    const selected = String(document.getSelection()?.toString() || "").trim();
    if (selected) return selected.slice(0, 20000);
    const record = lastDictation;
    if (!record?.element?.isConnected || getValueSnapshot(record.element) !== record.after) return "";
    // Copy only the most recent dictation, never the entire field/document contents.
    return String(record.insertedText || "").slice(0, 20000);
  }

  function selectedEditorAvailable() {
    const snapshot = selectionForInsert();
    return Boolean(snapshot && isEditable(snapshot.element));
  }

  function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => null);
  }

  function setFloatingStatus(state) {
    floatingState = state;
    if (!floatingHost || !floatingRoot) return;
    const card = floatingRoot.querySelector(".vt-card");
    const status = floatingRoot.querySelector(".vt-status");
    const dot = floatingRoot.querySelector(".vt-dot");
    const mainButton = floatingRoot.querySelector(".vt-toggle");
    const hideButton = floatingRoot.querySelector(".vt-hide");
    if (!card || !status || !dot || !mainButton || !hideButton) return;
    card.dataset.state = state?.status || "ready";
    const labels = { ready: "آماده", starting: "در حال شروع…", listening: "در حال گوش‌دادن…", processing: "در حال پردازش…", reconnecting: "اتصال مجدد…", stopping: "در حال توقف…", error: "خطا", mic_denied: "دسترسی میکروفون رد شد" };
    status.textContent = labels[state?.status] || "آماده";
    mainButton.textContent = state?.active ? "■ توقف" : "▶ شروع";
    hideButton.title = "مخفی‌کردن نشانگر";
  }

  async function setupFloating() {
    const result = await send({ type: "GET_PUBLIC_SETTINGS" });
    if (!result?.ok) return;
    settings = result.settings;
    if (!settings.showFloating) {
      if (floatingHost) floatingHost.style.display = "none";
      return;
    }
    if (floatingHost) {
      floatingHost.style.display = "block";
      return;
    }
    floatingHost = document.createElement("div");
    floatingHost.id = "vocatyp-floating-root";
    floatingHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:22px;bottom:22px;width:250px;max-width:calc(100vw - 24px);font-family:Inter,Segoe UI,Tahoma,Arial,sans-serif;direction:rtl;";
    floatingRoot = floatingHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `:host{all:initial}.vt-card{background:#fff;color:#1a2438;border:1px solid #e4e7f0;border-radius:14px;box-shadow:0 10px 35px #121b3326;overflow:hidden;font:12px/1.5 Inter,Segoe UI,Tahoma,Arial,sans-serif}.vt-head{display:flex;align-items:center;gap:8px;padding:9px 10px;background:#fafaff;cursor:move;user-select:none}.vt-dot{width:9px;height:9px;border-radius:50%;background:#9aa5b7;flex:none}.vt-card[data-state=listening] .vt-dot,.vt-card[data-state=reconnecting] .vt-dot{background:#ec414c;box-shadow:0 0 0 4px #ffebed;animation:pulse 1.4s infinite}.vt-card[data-state=processing] .vt-dot,.vt-card[data-state=starting] .vt-dot{background:#e9a52a}.vt-status{flex:1;font-weight:700}.vt-mini,.vt-hide,.vt-toggle{border:0;cursor:pointer;font:inherit}.vt-mini,.vt-hide{width:23px;height:23px;background:#f0efff;border-radius:7px;color:#5d4bd1}.vt-hide{background:transparent;color:#8290a8;font-size:16px}.vt-body{padding:7px 10px 10px}.vt-text{font-size:11px;color:#67738b;max-height:48px;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap;min-height:17px}.vt-text:empty:after{content:'متن موقت اینجا نمایش داده می‌شود';color:#a4adbc}.vt-controls{display:flex;justify-content:flex-start;margin-top:7px}.vt-toggle{border:0;border-radius:8px;padding:6px 11px;background:#6049dc;color:#fff;font-size:11px;font-weight:700}.vt-card[data-state=listening] .vt-toggle,.vt-card[data-state=reconnecting] .vt-toggle{background:#d6414a}.vt-card.compact .vt-body{display:none}@keyframes pulse{50%{opacity:.65;transform:scale(.92)}}`;
    const card = document.createElement("div");
    card.className = "vt-card";
    card.innerHTML = `<div class="vt-head"><span class="vt-dot"></span><span class="vt-status">آماده</span><button class="vt-mini" title="کوچک‌کردن">−</button><button class="vt-hide" title="مخفی‌کردن">×</button></div><div class="vt-body"><div class="vt-text"></div><div class="vt-controls"><button class="vt-toggle">▶ شروع</button></div></div>`;
    floatingRoot.append(style, card);
    floatingText = floatingRoot.querySelector(".vt-text");
    const settingsNow = result.settings;
    floatingHost.style.right = `${settingsNow.floatingPosition?.right ?? 22}px`;
    floatingHost.style.bottom = `${settingsNow.floatingPosition?.bottom ?? 22}px`;
    (document.documentElement || document.body).append(floatingHost);
    floatingRoot.querySelector(".vt-toggle").addEventListener("click", () => send({ type: "TOGGLE_FROM_CONTENT" }));
    floatingRoot.querySelector(".vt-mini").addEventListener("click", () => card.classList.toggle("compact"));
    floatingRoot.querySelector(".vt-hide").addEventListener("click", async () => {
      floatingHost.style.display = "none";
      await send({ type: "VT_SET_FLOATING_VISIBLE", visible: false });
    });
    const dragHandle = floatingRoot.querySelector(".vt-head");
    dragHandle.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      const rect = floatingHost.getBoundingClientRect();
      dragState = { startX: event.clientX, startY: event.clientY, right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom };
      dragHandle.setPointerCapture(event.pointerId);
    });
    dragHandle.addEventListener("pointermove", (event) => {
      if (!dragState) return;
      const right = Math.max(4, Math.min(window.innerWidth - 80, dragState.right - (event.clientX - dragState.startX)));
      const bottom = Math.max(4, Math.min(window.innerHeight - 35, dragState.bottom + (event.clientY - dragState.startY)));
      floatingHost.style.right = `${right}px`;
      floatingHost.style.bottom = `${bottom}px`;
    });
    const endDrag = () => {
      if (!dragState) return;
      const position = { right: Number.parseFloat(floatingHost.style.right) || 22, bottom: Number.parseFloat(floatingHost.style.bottom) || 22 };
      dragState = null;
      clearTimeout(positionSaveTimer);
      positionSaveTimer = setTimeout(() => send({ type: "SET_FLOATING_POSITION", position }), 200);
    };
    dragHandle.addEventListener("pointerup", endDrag);
    dragHandle.addEventListener("pointercancel", endDrag);
    setFloatingStatus(floatingState || { status: "ready", active: false });
  }

  function showError(error) {
    if (!floatingRoot) return;
    const text = floatingRoot.querySelector(".vt-text");
    if (text) text.textContent = String(error || "خطا").slice(0, 300);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id && sender.id !== EXTENSION_ID) return false;
    if (!message || typeof message.type !== "string") return false;
    if (message.type === "VT_PREPARE") {
      setupFloating().then(() => sendResponse({ ready: true, editable: selectedEditorAvailable() }));
      return true;
    }
    if (message.type === "VT_STATE") {
      setFloatingStatus(message.state || {});
      if (message.state?.error) showError(message.state.error);
      return false;
    }
    if (message.type === "VT_INTERIM") {
      if (floatingText) floatingText.textContent = String(message.text || "").slice(-800);
      return false;
    }
    if (message.type === "VT_ERROR") {
      showError(message.message);
      return false;
    }
    if (message.type === "VT_SETTINGS_CHANGED") {
      settings = message.settings;
      if (settings?.showFloating) setupFloating();
      else if (floatingHost) floatingHost.style.display = "none";
      return false;
    }
    if (message.type === "VT_INSERT") {
      const result = insertText(String(message.text || "").slice(0, 20000), { trackForCopy: message.commandText !== true });
      if (result.ok && floatingText) floatingText.textContent = "";
      sendResponse(result);
      return false;
    }
    if (message.type === "VT_COMMAND") {
      let result = { ok: true };
      if (message.command === "delete-last") result = clearLastDictation();
      else if (message.command === "clear-session") result = clearSessionDictation();
      else if (message.command === "undo") result = undoLast();
      else if (message.command === "redo") result = redoLast();
      if (result.error) showError(result.error);
      sendResponse(result);
      return false;
    }
    if (message.type === "VT_GET_COPY_TEXT") {
      sendResponse({ text: getCopyText() });
      return false;
    }
    return false;
  });

  window.addEventListener("pagehide", () => send({ type: "VT_PAGE_UNLOAD" }));
  window.addEventListener("pageshow", () => { if (floatingHost && settings?.showFloating) floatingHost.style.display = "block"; });
})();
