/* =========================================================
   ChatAI — ChatGPT-style UI logic (vanilla JS, no deps)
   ========================================================= */
(() => {
  "use strict";

  // ---------- Elements ----------
  const $ = (s, el = document) => el.querySelector(s);
  const app = $(".app");
  const main = $(".main");
  const chatEl = $("#chat");
  const messagesEl = $("#messages");
  const historyEl = $("#history");
  const input = $("#input");
  const form = $("#composer");
  const sendBtn = $("#sendBtn");
  const fileInput = $("#fileInput");
  const attachmentsEl = $("#attachments");
  const scrollDownBtn = $("#scrollDown");
  const modelBtn = $("#modelBtn");
  const modelMenu = $("#modelMenu");
  const toastEl = $("#toast");

  const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

  // ---------- Icons ----------
  const ICON = {
    logo: '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    regen: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    like: '<svg viewBox="0 0 24 24"><path d="M7 10v12"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.4 22H7V10l4-8a3 3 0 0 1 3 3.9Z"/></svg>',
    dislike: '<svg viewBox="0 0 24 24"><path d="M17 14V2"/><path d="M9 18.1 10 14H4.2a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.6 2H17v12l-4 8a3 3 0 0 1-3-3.9Z"/></svg>',
    speak: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 17v5"/><path d="M9 10.8V4h6v6.8l3 3.2H6z"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  };

  // ---------- State ----------
  const STORE_KEY = "chatai.v1";
  let state = load();
  let pendingFiles = [];
  let generating = false;
  let stopRequested = false;
  let autoScroll = true;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.chats)) return s;
    } catch (_) {}
    return { chats: [], currentId: null, theme: null, model: "ChatAI 4o" };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const current = () => state.chats.find((c) => c.id === state.currentId) || null;

  // ---------- Theme ----------
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('meta[name="theme-color"]').setAttribute("content", t === "dark" ? "#343541" : "#ffffff");
  }
  applyTheme(state.theme || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  $("#themeToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    state.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(state.theme);
    save();
  });

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  // ---------- Sidebar ----------
  function openSidebar() {
    if (isMobile()) app.classList.add("sidebar-open");
    else app.classList.remove("collapsed");
  }
  function closeSidebar() {
    if (isMobile()) app.classList.remove("sidebar-open");
    else app.classList.add("collapsed");
  }
  $("#openSidebar").addEventListener("click", openSidebar);
  $("#closeSidebar").addEventListener("click", closeSidebar);
  $("#overlay").addEventListener("click", closeSidebar);

  // swipe gestures on mobile
  let touchX = null, touchY = null;
  document.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (touchX === null || !isMobile()) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchY);
    if (dy < 60) {
      if (dx > 70 && touchX < 40) openSidebar();
      if (dx < -70 && app.classList.contains("sidebar-open")) closeSidebar();
    }
    touchX = null;
  }, { passive: true });

  // ---------- Model picker ----------
  function setModel(name) {
    state.model = name;
    $("#modelName").textContent = name;
    modelMenu.querySelectorAll(".model-item").forEach((b) =>
      b.classList.toggle("active", b.dataset.model === name));
    save();
  }
  setModel(state.model || "ChatAI 4o");
  modelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    modelMenu.classList.toggle("open");
  });
  modelMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".model-item");
    if (!item) return;
    setModel(item.dataset.model);
    modelMenu.classList.remove("open");
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".model-picker")) modelMenu.classList.remove("open");
    if (!e.target.closest(".h-menu") && !e.target.closest(".h-more")) closeHistoryMenu();
  });

  // ---------- History ----------
  function groupLabel(ts) {
    const d = new Date(ts), now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 864e5;
    if (ts >= startToday) return "Hari ini";
    if (ts >= startToday - day) return "Kemarin";
    if (ts >= startToday - 7 * day) return "7 hari terakhir";
    if (ts >= startToday - 30 * day) return "30 hari terakhir";
    return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  }

  function renderHistory() {
    const q = $("#searchChats").value.trim().toLowerCase();
    const list = state.chats
      .filter((c) => !q || c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q)))
      .sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));

    historyEl.innerHTML = "";
    if (!list.length) {
      historyEl.innerHTML = `<p class="history-empty">${q ? "Tidak ada hasil." : "Belum ada percakapan."}</p>`;
      return;
    }
    const groups = new Map();
    list.forEach((c) => {
      const label = c.pinned ? "Disematkan" : groupLabel(c.updated);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(c);
    });
    groups.forEach((items, label) => {
      const g = document.createElement("div");
      g.className = "history-group";
      g.innerHTML = `<div class="history-label">${label}</div>`;
      items.forEach((c) => {
        const it = document.createElement("div");
        it.className = "history-item" + (c.id === state.currentId ? " active" : "");
        it.dataset.id = c.id;
        it.innerHTML = `<button class="h-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button>
          <button class="h-more" aria-label="Opsi">${ICON.more}</button>`;
        g.appendChild(it);
      });
      historyEl.appendChild(g);
    });
  }

  historyEl.addEventListener("click", (e) => {
    const item = e.target.closest(".history-item");
    if (!item) return;
    if (e.target.closest(".h-more")) {
      e.stopPropagation();
      openHistoryMenu(item.dataset.id, e.target.closest(".h-more"));
      return;
    }
    if (e.target.closest(".h-title")) {
      openChat(item.dataset.id);
      if (isMobile()) closeSidebar();
    }
  });
  $("#searchChats").addEventListener("input", renderHistory);

  let hMenu = null;
  function closeHistoryMenu() { if (hMenu) { hMenu.remove(); hMenu = null; } }
  function openHistoryMenu(id, anchor) {
    closeHistoryMenu();
    const chat = state.chats.find((c) => c.id === id);
    hMenu = document.createElement("div");
    hMenu.className = "h-menu";
    hMenu.innerHTML = `
      <button data-act="pin">${ICON.pin}<span>${chat.pinned ? "Lepas sematan" : "Sematkan"}</span></button>
      <button data-act="rename">${ICON.edit}<span>Ganti nama</span></button>
      <button data-act="delete" class="danger">${ICON.trash}<span>Hapus</span></button>`;
    document.body.appendChild(hMenu);
    const r = anchor.getBoundingClientRect();
    const mh = hMenu.offsetHeight, mw = hMenu.offsetWidth;
    hMenu.style.top = Math.min(r.bottom + 4, window.innerHeight - mh - 8) + "px";
    hMenu.style.left = Math.min(r.left, window.innerWidth - mw - 8) + "px";
    hMenu.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      closeHistoryMenu();
      if (act === "pin") { chat.pinned = !chat.pinned; save(); renderHistory(); }
      if (act === "rename") startRename(id);
      if (act === "delete") deleteChat(id);
    });
  }

  function startRename(id) {
    const item = historyEl.querySelector(`.history-item[data-id="${id}"]`);
    const chat = state.chats.find((c) => c.id === id);
    if (!item) return;
    const inp = document.createElement("input");
    inp.className = "h-edit";
    inp.value = chat.title;
    item.replaceChildren(inp);
    inp.focus(); inp.select();
    const done = (commit) => {
      if (commit && inp.value.trim()) chat.title = inp.value.trim();
      save(); renderHistory();
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") done(false);
    });
    inp.addEventListener("blur", () => done(true));
  }

  function deleteChat(id) {
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.currentId === id) state.currentId = null;
    save(); renderHistory(); renderMessages();
    toast("Percakapan dihapus");
  }

  // ---------- Chat open / new ----------
  function newChat() {
    if (generating) stopGeneration();
    state.currentId = null;
    save();
    renderHistory();
    renderMessages();
    input.focus();
    if (isMobile()) closeSidebar();
  }
  ["#newChat", "#newChatTop", "#newChatMobile"].forEach((s) => $(s).addEventListener("click", newChat));
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); app.classList.contains("collapsed") ? openSidebar() : closeSidebar(); }
  });

  function openChat(id) {
    if (generating) stopGeneration();
    state.currentId = id;
    save();
    renderHistory();
    renderMessages();
  }

  // ---------- Rendering messages ----------
  function renderMessages() {
    const chat = current();
    messagesEl.innerHTML = "";
    const empty = !chat || !chat.messages.length;
    main.classList.toggle("empty", empty);
    document.title = chat ? `${chat.title} · ChatAI` : "ChatAI";
    if (empty) return;
    chat.messages.forEach((m, i) => messagesEl.appendChild(buildMessage(m, i)));
    scrollToBottom(false);
  }

  function buildMessage(m, index) {
    const el = document.createElement("div");
    el.className = "msg " + (m.role === "user" ? "user" : "ai");
    el.dataset.index = index;
    if (m.role === "user") {
      const files = (m.files || []).map((f) =>
        `<div class="file-chip"><div class="f-ico">${ICON.file}</div><span>${escapeHtml(f)}</span></div>`).join("");
      el.innerHTML = `
        <div class="msg-col">
          ${files ? `<div class="msg-files">${files}</div>` : ""}
          <div class="bubble">${escapeHtml(m.content)}</div>
          <div class="msg-actions">
            <button data-act="copy" title="Salin">${ICON.copy}</button>
            <button data-act="edit" title="Edit">${ICON.edit}</button>
          </div>
        </div>
        <div class="avatar user-avatar" aria-hidden="true">U</div>`;
    } else {
      el.innerHTML = `
        <div class="ai-avatar" aria-hidden="true">${ICON.logo}</div>
        <div class="ai-body">
          <div class="ai-bubble">
            <div class="ai-name">ChatAI</div>
            <div class="md">${renderMarkdown(m.content)}</div>
          </div>
          <div class="msg-actions">
            <button data-act="copy" title="Salin">${ICON.copy}</button>
            <button data-act="like" title="Respons bagus" class="${m.feedback === "like" ? "on" : ""}">${ICON.like}</button>
            <button data-act="dislike" title="Respons buruk" class="${m.feedback === "dislike" ? "on" : ""}">${ICON.dislike}</button>
            <button data-act="speak" title="Bacakan">${ICON.speak}</button>
            <button data-act="regen" title="Buat ulang">${ICON.regen}</button>
          </div>
        </div>`;
    }
    return el;
  }

  messagesEl.addEventListener("click", async (e) => {
    // code copy
    const codeBtn = e.target.closest(".code-copy");
    if (codeBtn) {
      const code = codeBtn.closest(".code-block").querySelector("code").innerText;
      await copyText(code);
      codeBtn.innerHTML = `${ICON.check}<span>Disalin</span>`;
      setTimeout(() => (codeBtn.innerHTML = `${ICON.copy}<span>Salin</span>`), 1500);
      return;
    }
    const btn = e.target.closest(".msg-actions button");
    if (!btn) return;
    const msgEl = btn.closest(".msg");
    const idx = +msgEl.dataset.index;
    const chat = current();
    const m = chat.messages[idx];
    switch (btn.dataset.act) {
      case "copy":
        await copyText(m.content);
        btn.innerHTML = ICON.check;
        setTimeout(() => (btn.innerHTML = ICON.copy), 1500);
        break;
      case "like":
      case "dislike":
        m.feedback = m.feedback === btn.dataset.act ? null : btn.dataset.act;
        save();
        msgEl.querySelector('[data-act="like"]').classList.toggle("on", m.feedback === "like");
        msgEl.querySelector('[data-act="dislike"]').classList.toggle("on", m.feedback === "dislike");
        if (m.feedback) toast("Terima kasih atas masukannya!");
        break;
      case "speak":
        speak(m.content, btn);
        break;
      case "regen":
        if (generating) return;
        chat.messages = chat.messages.slice(0, idx);
        save(); renderMessages();
        generateReply();
        break;
      case "edit":
        if (generating) return;
        startEdit(msgEl, idx);
        break;
    }
  });

  function startEdit(msgEl, idx) {
    const chat = current();
    const box = document.createElement("div");
    box.className = "edit-box";
    box.innerHTML = `<textarea rows="1"></textarea>
      <div class="edit-btns"><button class="edit-cancel">Batal</button><button class="edit-send">Kirim</button></div>`;
    const ta = box.querySelector("textarea");
    ta.value = chat.messages[idx].content;
    msgEl.replaceChildren(box);
    autoGrow(ta); ta.focus();
    ta.addEventListener("input", () => autoGrow(ta));
    box.querySelector(".edit-cancel").onclick = renderMessages;
    box.querySelector(".edit-send").onclick = () => {
      const v = ta.value.trim();
      if (!v) return;
      chat.messages = chat.messages.slice(0, idx);
      chat.messages.push({ role: "user", content: v });
      save(); renderMessages();
      generateReply();
    };
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); }
    catch (_) {
      const ta = document.createElement("textarea");
      ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    }
    toast("Disalin ke clipboard");
  }

  function speak(text, btn) {
    if (!("speechSynthesis" in window)) return toast("Text-to-speech tidak didukung");
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.classList.remove("on"); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/[#*`>|_-]/g, ""));
    u.lang = "id-ID";
    u.onend = () => btn.classList.remove("on");
    btn.classList.add("on");
    speechSynthesis.speak(u);
  }

  // ---------- Scroll ----------
  function scrollToBottom(smooth = true) {
    chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }
  chatEl.addEventListener("scroll", () => {
    const dist = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
    autoScroll = dist < 80;
    scrollDownBtn.classList.toggle("show", dist > 200 && !main.classList.contains("empty"));
  });
  scrollDownBtn.addEventListener("click", () => { autoScroll = true; scrollToBottom(); });

  // ---------- Composer ----------
  function autoGrow(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 220) + "px";
  }
  function updateSendState() {
    sendBtn.disabled = !generating && !input.value.trim() && !pendingFiles.length;
  }
  input.addEventListener("input", () => { autoGrow(input); updateSendState(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !isMobile()) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (generating) return stopGeneration();
    const text = input.value.trim();
    if (!text && !pendingFiles.length) return;
    sendMessage(text || "Tolong analisis file terlampir.");
  });

  document.querySelectorAll(".suggestion").forEach((b) =>
    b.addEventListener("click", () => sendMessage(b.dataset.prompt)));

  ["#searchTool", "#thinkTool"].forEach((s) =>
    $(s).addEventListener("click", (e) => e.currentTarget.classList.toggle("on")));

  // attachments
  fileInput.addEventListener("change", () => {
    [...fileInput.files].forEach((f) => pendingFiles.push(f.name));
    fileInput.value = "";
    renderAttachments();
  });
  function renderAttachments() {
    attachmentsEl.innerHTML = pendingFiles.map((f, i) =>
      `<div class="file-chip"><div class="f-ico">${ICON.file}</div><span>${escapeHtml(f)}</span>
       <button type="button" data-i="${i}" aria-label="Hapus">${ICON.x}</button></div>`).join("");
    updateSendState();
  }
  attachmentsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    pendingFiles.splice(+b.dataset.i, 1);
    renderAttachments();
  });

  // voice dictation
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  $("#micBtn").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (!SR) return toast("Dikte suara tidak didukung browser ini");
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = "id-ID";
    rec.interimResults = true;
    const base = input.value;
    rec.onresult = (ev) => {
      input.value = base + [...ev.results].map((r) => r[0].transcript).join("");
      autoGrow(input); updateSendState();
    };
    rec.onend = () => { rec = null; btn.style.color = ""; };
    btn.style.color = "#ef4444";
    rec.start();
  });

  // share
  $("#shareBtn").addEventListener("click", async () => {
    const chat = current();
    if (!chat) return;
    const text = chat.messages.map((m) => `${m.role === "user" ? "Anda" : "ChatAI"}: ${m.content}`).join("\n\n");
    if (navigator.share) {
      try { await navigator.share({ title: chat.title, text }); } catch (_) {}
    } else copyText(text);
  });

  // ---------- Send / generate ----------
  function sendMessage(text) {
    if (generating) return;
    let chat = current();
    if (!chat) {
      chat = { id: uid(), title: makeTitle(text), messages: [], updated: Date.now(), pinned: false };
      state.chats.push(chat);
      state.currentId = chat.id;
    }
    chat.messages.push({ role: "user", content: text, files: pendingFiles.length ? [...pendingFiles] : undefined });
    chat.updated = Date.now();
    pendingFiles = [];
    renderAttachments();
    input.value = "";
    autoGrow(input);
    save();
    renderHistory();
    renderMessages();
    autoScroll = true;
    generateReply();
  }

  function makeTitle(t) {
    const s = t.replace(/\s+/g, " ").trim();
    return s.length > 40 ? s.slice(0, 40).trim() + "…" : s;
  }

  function setGenerating(v) {
    generating = v;
    sendBtn.classList.toggle("generating", v);
    sendBtn.title = v ? "Hentikan" : "Kirim";
    updateSendState();
  }

  function stopGeneration() { stopRequested = true; }

  async function generateReply() {
    const chat = current();
    const chatId = chat.id;
    const last = chat.messages[chat.messages.length - 1];
    const reply = { role: "assistant", content: "" };
    chat.messages.push(reply);
    const idx = chat.messages.length - 1;

    const el = buildMessage(reply, idx);
    el.classList.add("streaming");
    const md = el.querySelector(".md");
    const thinkLabel = $("#thinkTool").classList.contains("on") ? "Sedang bernalar" :
      $("#searchTool").classList.contains("on") ? "Mencari di web" : "";
    md.innerHTML = thinkLabel
      ? `<div class="thinking"><span class="shimmer">${thinkLabel}…</span></div>`
      : `<div class="thinking" aria-label="AI sedang mengetik"><span class="typing"><span></span><span></span><span></span></span></div>`;
    messagesEl.appendChild(el);
    scrollToBottom();

    setGenerating(true);
    stopRequested = false;

    // typing indicator duration
    await sleep(thinkLabel ? 1600 : 900 + Math.random() * 600);

    // typewriter effect: reveal a few characters per frame
    const full = mockResponse(last.content);
    let out = "";
    let pos = 0;
    while (pos < full.length) {
      if (stopRequested || state.currentId !== chatId) break;
      const step = 2 + Math.floor(Math.random() * 3);
      pos = Math.min(full.length, pos + step);
      out = full.slice(0, pos);
      reply.content = out;
      md.innerHTML = renderMarkdown(out);
      if (autoScroll) chatEl.scrollTop = chatEl.scrollHeight;
      const ch = full[pos - 1];
      await sleep(/[.!?\n]/.test(ch) ? 60 : 12 + Math.random() * 14);
    }
    reply.content = out || "_(Dihentikan)_";
    chat.updated = Date.now();
    save();
    setGenerating(false);
    if (state.currentId === chatId) {
      el.classList.remove("streaming");
      md.innerHTML = renderMarkdown(reply.content);
    }
    renderHistory();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Mock AI ----------
  function mockResponse(q) {
    const t = q.toLowerCase();
    if (/(kode|code|python|javascript|program|fungsi|script|csv)/.test(t)) {
      return `Tentu! Berikut contoh kode **Python** untuk membaca file CSV menggunakan modul bawaan \`csv\` dan juga dengan \`pandas\`.

### 1. Menggunakan modul \`csv\`

\`\`\`python
import csv

def baca_csv(path):
    # Membuka file dan membaca setiap baris sebagai dictionary
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            print(row["nama"], row["umur"])

baca_csv("data.csv")
\`\`\`

### 2. Menggunakan \`pandas\`

\`\`\`python
import pandas as pd

df = pd.read_csv("data.csv")
print(df.head(5))       # 5 baris pertama
print(df.describe())    # ringkasan statistik
\`\`\`

| Metode | Kelebihan | Cocok untuk |
|---|---|---|
| \`csv\` | Tanpa dependensi | File kecil & sederhana |
| \`pandas\` | Analisis data kuat | Dataset besar & olah data |

> **Tips:** gunakan \`encoding="utf-8"\` agar karakter khusus terbaca dengan benar.

Mau saya bantu menambahkan fitur filter atau ekspor ke Excel?`;
    }
    if (/(rencana|belajar|jadwal|plan|roadmap)/.test(t)) {
      return `Berikut **rencana belajar JavaScript 30 hari** yang terstruktur:

## Minggu 1 — Dasar-dasar
1. Variabel (\`let\`, \`const\`) & tipe data
2. Operator dan percabangan (\`if\`, \`switch\`)
3. Perulangan (\`for\`, \`while\`)
4. Fungsi & arrow function

## Minggu 2 — Struktur Data
- Array & method penting: \`map\`, \`filter\`, \`reduce\`
- Object, destructuring, spread operator
- String manipulation

## Minggu 3 — DOM & Browser
- Memilih dan memanipulasi elemen
- Event listener
- Mini project: **To-Do List**

## Minggu 4 — Asynchronous & Proyek
- Promise, \`async/await\`, \`fetch\` API
- Modul ES6
- Proyek akhir: **Aplikasi cuaca** dengan API publik

\`\`\`javascript
// Contoh async/await
async function getData() {
  const res = await fetch("https://api.example.com/data");
  return await res.json();
}
\`\`\`

---

Luangkan **1–2 jam per hari** dan konsisten. Mau saya buatkan versi checklist harian?`;
    }
    if (/(ide|nama|brainstorm|kreatif)/.test(t)) {
      return `Berikut beberapa ide nama untuk **kedai kopi modern** ☕:

1. **Seduh Senja** — hangat dan puitis
2. **Kopi Ruang** — simpel, cocok untuk konsep coworking
3. **Arunika Coffee** — "arunika" berarti cahaya matahari pagi
4. **Biji Kota** — urban dan membumi
5. **Tegukan** — singkat dan mudah diingat
6. **Nara Roastery** — elegan, cocok untuk spesialti
7. **Kopi Lintas** — konsep grab & go

**Tips memilih nama:**
- Mudah diucapkan dan diingat
- Cek ketersediaan username Instagram & domain
- Sesuaikan dengan target pasar dan suasana tempat

Mau saya bantu membuat tagline atau konsep logonya juga?`;
    }
    if (/(halo|hai|hello|hi\b|pagi|siang|malam)/.test(t)) {
      return `Halo! 👋 Senang bertemu dengan Anda. Ada yang bisa saya bantu hari ini? Saya bisa membantu menulis, menjawab pertanyaan, membuat kode, atau sekadar ngobrol.`;
    }
    return `Pertanyaan yang menarik! Mari saya jelaskan secara sederhana.

**Kecerdasan Buatan (AI)** adalah cabang ilmu komputer yang membuat mesin mampu melakukan tugas yang biasanya membutuhkan kecerdasan manusia — seperti memahami bahasa, mengenali gambar, dan mengambil keputusan.

### Cara kerjanya secara singkat
1. **Data** — AI belajar dari contoh dalam jumlah besar.
2. **Model** — pola dari data disimpan dalam bentuk model matematis.
3. **Prediksi** — model digunakan untuk menjawab atau menebak hal baru.

### Contoh dalam kehidupan sehari-hari
- Rekomendasi video di YouTube
- Asisten suara seperti Google Assistant
- Filter spam di email
- Chatbot seperti saya 🙂

> Analogi: AI itu seperti murid yang belajar dari ribuan soal latihan, lalu bisa mengerjakan soal baru yang belum pernah dilihat.

Ada bagian yang ingin dibahas lebih dalam?`;
  }

  // ---------- Markdown renderer (lightweight) ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function inline(s) {
    s = escapeHtml(s);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
         .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
         .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1<em>$2</em>")
         .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }

  const KW = /\b(import|from|def|return|for|in|while|if|elif|else|with|as|class|try|except|const|let|var|function|async|await|new|this|true|false|null|None|True|False|print|export|default)\b/;
  function highlight(code) {
    const re = /(#[^\n]*|\/\/[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)(?=\s*\()|\b([A-Za-z_]\w*)\b/g;
    let out = "", last = 0, m;
    while ((m = re.exec(code))) {
      out += escapeHtml(code.slice(last, m.index));
      const [tok, cm, str, num, fn, word] = m;
      if (cm) out += `<span class="tok-c">${escapeHtml(cm)}</span>`;
      else if (str) out += `<span class="tok-s">${escapeHtml(str)}</span>`;
      else if (num) out += `<span class="tok-n">${num}</span>`;
      else if (fn) out += KW.test(fn) ? `<span class="tok-k">${fn}</span>` : `<span class="tok-f">${fn}</span>`;
      else if (word) out += KW.test(word) && word.match(KW)[0] === word ? `<span class="tok-k">${word}</span>` : word;
      else out += escapeHtml(tok);
      last = re.lastIndex;
    }
    return out + escapeHtml(code.slice(last));
  }

  function renderMarkdown(src) {
    const lines = src.replace(/\r/g, "").split("\n");
    let html = "", i = 0;
    while (i < lines.length) {
      let line = lines[i];

      // fenced code (supports unterminated while streaming)
      const fence = line.match(/^```(\w*)/);
      if (fence) {
        const lang = fence[1] || "code";
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        html += `<div class="code-block"><div class="code-head"><span>${escapeHtml(lang)}</span>
          <button class="code-copy">${ICON.copy}<span>Salin</span></button></div>
          <pre><code>${highlight(buf.join("\n"))}</code></pre></div>`;
        continue;
      }
      if (!line.trim()) { i++; continue; }

      const h = line.match(/^(#{1,3})\s+(.*)/);
      if (h) { html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) { html += "<hr>"; i++; continue; }

      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
        html += `<blockquote><p>${inline(buf.join(" "))}</p></blockquote>`;
        continue;
      }

      // table
      if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
        html += "<table><thead><tr>" + cells(line).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>";
        i += 2;
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]))
          html += "<tr>" + cells(lines[i++]).map((c) => `<td>${c}</td>`).join("") + "</tr>";
        html += "</tbody></table>";
        continue;
      }

      // lists
      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const tag = ordered ? "ol" : "ul";
        html += `<${tag}>`;
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]))
          html += `<li>${inline(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`;
        html += `</${tag}>`;
        continue;
      }

      // paragraph
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|>|\s*([-*]|\d+\.)\s+|\|)/.test(lines[i]))
        buf.push(lines[i++]);
      if (!buf.length) buf.push(lines[i++]);
      html += `<p>${buf.map(inline).join("<br>")}</p>`;
    }
    return html;
  }

  // ---------- Init ----------
  if (isMobile()) app.classList.remove("collapsed");
  window.addEventListener("resize", () => {
    if (!isMobile()) app.classList.remove("sidebar-open");
  });
  renderHistory();
  renderMessages();
  updateSendState();
  if (!isMobile()) input.focus();
})();
