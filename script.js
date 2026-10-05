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
  let currentAbortController = null;

  const OFFICIAL_MODELS = ["Claude Opus 5.5", "Claude Sonnet 5.5", "Gemini 3.8 Flash"];

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.chats)) {
        if (!s.model || !OFFICIAL_MODELS.includes(s.model)) {
          s.model = "Gemini 3.8 Flash";
        }
        if (typeof s.tokensUsed !== "number") s.tokensUsed = 1480;
        if (!s.apiKeys || typeof s.apiKeys !== "object") {
          s.apiKeys = { gemini: "", claude: "", openai: "" };
        }
        return s;
      }
    } catch (_) {}
    return {
      chats: [],
      currentId: null,
      theme: null,
      model: "Gemini 3.8 Flash",
      tokensUsed: 1480,
      apiKeys: { gemini: "", claude: "", openai: "" }
    };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const current = () => state.chats.find((c) => c.id === state.currentId) || null;

  // ---------- Usage & Quota Widget Sync ----------
  function updateUsageWidget(deltaTokens = 0) {
    if (typeof state.tokensUsed !== "number") state.tokensUsed = 1480;
    if (deltaTokens > 0) state.tokensUsed += deltaTokens;
    const tierEl = $("#profileTier");
    const isPro = (state.apiKeys?.gemini && state.apiKeys.gemini.length > 5) || (tierEl && tierEl.textContent.includes("Pro"));
    const maxTokens = isPro ? 50000 : 10000;
    const pct = Math.min(100, Math.max(5, Math.round((state.tokensUsed / maxTokens) * 100)));
    const percentEl = $("#usagePercent");
    const barEl = $("#usageBarFill");
    const labelEl = $("#tokenCountLabel");
    if (percentEl) percentEl.textContent = `${pct}%`;
    if (barEl) barEl.style.width = `${pct}%`;
    if (labelEl) labelEl.textContent = `${state.tokensUsed.toLocaleString()} / ${maxTokens.toLocaleString()} tokens`;
    save();
  }

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
  setModel(state.model || "Gemini 3.8 Flash");
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

  // ---------- API Settings Modal ----------
  const apiModal = $("#apiModal");
  const openApiSettings = $("#openApiSettings");
  const closeApiModal = $("#closeApiModal");
  const saveApiKeysBtn = $("#saveApiKeys");
  const clearApiKeysBtn = $("#clearApiKeys");
  const verifyApiKeyBtn = $("#verifyApiKeyBtn");
  const keyVerifyStatus = $("#keyVerifyStatus");
  const keyGeminiInput = $("#keyGemini");
  const keyClaudeInput = $("#keyClaude");
  const keyOpenAIInput = $("#keyOpenAI");
  const profileNameEl = $("#profileName");
  const profileTierEl = $("#profileTier");

  if (openApiSettings) {
    openApiSettings.addEventListener("click", (e) => {
      e.stopPropagation();
      modelMenu.classList.remove("open");
      keyGeminiInput.value = state.apiKeys?.gemini || "";
      keyClaudeInput.value = state.apiKeys?.claude || "";
      keyOpenAIInput.value = state.apiKeys?.openai || "";
      if (keyVerifyStatus) {
        keyVerifyStatus.style.display = "none";
        keyVerifyStatus.className = "key-verify-status";
        keyVerifyStatus.textContent = "";
      }
      apiModal.classList.add("open");
    });
  }
  if (closeApiModal) {
    closeApiModal.addEventListener("click", () => apiModal.classList.remove("open"));
  }
  if (apiModal) {
    apiModal.addEventListener("click", (e) => {
      if (e.target === apiModal) apiModal.classList.remove("open");
    });
  }

  // Live test & verification for Gemini API Key
  if (verifyApiKeyBtn) {
    verifyApiKeyBtn.addEventListener("click", async () => {
      const geminiKey = keyGeminiInput.value.trim();
      if (!geminiKey) {
        if (keyVerifyStatus) {
          keyVerifyStatus.style.display = "block";
          keyVerifyStatus.className = "key-verify-status error";
          keyVerifyStatus.textContent = "Silakan masukkan Google Gemini API Key terlebih dahulu untuk diverifikasi.";
        }
        return;
      }

      verifyApiKeyBtn.disabled = true;
      if (keyVerifyStatus) {
        keyVerifyStatus.style.display = "block";
        keyVerifyStatus.className = "key-verify-status loading";
        keyVerifyStatus.textContent = "Sedang memverifikasi kunci ke Google Gemini API...";
      }

      try {
        const resp = await fetch("/api/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: geminiKey })
        });
        const data = await resp.json();
        if (resp.ok && (data.valid || data.keyValid || data.status === "Connected")) {
          keyVerifyStatus.className = "key-verify-status success";
          keyVerifyStatus.textContent = `✓ Kunci Terverifikasi! Model aktif: ${data.activeModel || "gemini-3.8-flash"} (${data.modelsAvailable || "Semua"} model aktif).`;
          if (profileTierEl) profileTierEl.textContent = data.account?.tier || "Pro (Verified)";
          toast("Kunci API valid & terverifikasi");
        } else {
          keyVerifyStatus.className = "key-verify-status error";
          keyVerifyStatus.textContent = `✗ Verifikasi Gagal: ${data.message || data.error || "Kunci API tidak valid"}`;
          toast("Verifikasi kunci gagal");
        }
      } catch (err) {
        keyVerifyStatus.className = "key-verify-status error";
        keyVerifyStatus.textContent = `✗ Kesalahan Jaringan: ${err.message}`;
        toast("Koneksi verifikasi gagal");
      } finally {
        verifyApiKeyBtn.disabled = false;
      }
    });
  }

  if (saveApiKeysBtn) {
    saveApiKeysBtn.addEventListener("click", () => {
      state.apiKeys = {
        gemini: keyGeminiInput.value.trim(),
        claude: keyClaudeInput.value.trim(),
        openai: keyOpenAIInput.value.trim()
      };
      save();
      apiModal.classList.remove("open");
      toast("Pengaturan kunci API tersimpan");
      // Immediate live sync after saving
      syncData();
    });
  }

  if (clearApiKeysBtn) {
    clearApiKeysBtn.addEventListener("click", () => {
      keyGeminiInput.value = "";
      keyClaudeInput.value = "";
      keyOpenAIInput.value = "";
      state.apiKeys = { gemini: "", claude: "", openai: "" };
      save();
      if (keyVerifyStatus) keyVerifyStatus.style.display = "none";
      if (profileTierEl) profileTierEl.textContent = "Gratis";
      toast("Kunci API telah dibersihkan");
      syncData();
    });
  }

  // ---------- Real-Time Sync / Live Fetch ----------
  let syncing = false;
  async function syncData() {
    if (syncing) return;
    syncing = true;
    const icons = document.querySelectorAll(".sync-icon");
    icons.forEach((ic) => ic.classList.add("spinning"));

    const apiKeyStatusText = $("#statusApiKeyText");
    const apiDot = $("#statusApiDot");
    const modelStatusText = $("#statusModelText");
    const modelDot = $("#statusModelDot");

    let toastMessage = "Akun/API Key berhasil tersambung & tersinkronisasi!";

    try {
      // Connect to status endpoint (/api/status) with active client key
      const headers = {};
      if (state.apiKeys?.gemini) {
        headers["x-gemini-key"] = state.apiKeys.gemini;
      }
      const res = await fetch("/api/status", { method: "GET", headers });
      const data = await res.json();

      if (data.status === "Connected" || data.valid || data.keyValid) {
        if (apiKeyStatusText) apiKeyStatusText.textContent = "API: Connected";
        if (apiDot) apiDot.classList.remove("disconnected");
        if (modelStatusText) {
          modelStatusText.textContent = `Model: ${data.activeModel || "gemini-3.8-flash"}`;
        }
        if (modelDot) modelDot.classList.remove("disconnected");
        if (profileTierEl) {
          profileTierEl.textContent = data.account?.tier || "Pro (Verified)";
        }
        if (profileNameEl && data.account?.name) {
          profileNameEl.textContent = data.account.name;
        }
        if (typeof data.account?.quotaUsed === "number") {
          state.tokensUsed = data.account.quotaUsed;
        }
        toastMessage = "Akun/API Key berhasil tersambung & tersinkronisasi!";
      } else {
        if (apiKeyStatusText) apiKeyStatusText.textContent = `API: ${data.connection || "Disconnected"}`;
        if (apiDot) apiDot.classList.add("disconnected");
        if (modelStatusText) {
          modelStatusText.textContent = `Model: ${data.activeModel || "gemini-3.8-flash"}`;
        }
        if (profileTierEl) {
          profileTierEl.textContent = "Gratis / Setup";
        }
        toastMessage = data.message || "API Key belum terpasang atau tidak valid";
      }
    } catch (e) {
      console.warn("Status fetch notice:", e.message);
      if (apiKeyStatusText) apiKeyStatusText.textContent = "API: Offline / Local";
      if (apiDot) apiDot.classList.add("disconnected");
      toastMessage = "Gagal menghubungi endpoint status";
    }

    // Refresh quota indicators & model state
    updateUsageWidget();
    setModel(state.model || "Gemini 3.8 Flash");
    renderHistory();

    await sleep(400);
    icons.forEach((ic) => ic.classList.remove("spinning"));
    syncing = false;
    toast(toastMessage);
  }

  const syncBtn = $("#syncBtn");
  if (syncBtn) syncBtn.addEventListener("click", syncData);
  const sidebarSyncBtn = $("#sidebarSyncBtn");
  if (sidebarSyncBtn) sidebarSyncBtn.addEventListener("click", syncData);

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".model-picker")) {
      modelMenu.classList.remove("open");
    }
    if (!e.target.closest(".h-menu") && !e.target.closest(".h-more")) {
      closeHistoryMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      modelMenu.classList.remove("open");
      if (apiModal) apiModal.classList.remove("open");
      closeHistoryMenu();
    }
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
    if (state.currentId === id && generating) stopGeneration();
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
      const files = (m.files || []).map((f) => {
        const name = typeof f === "string" ? f : f.name;
        const isImg = f.data && f.type && f.type.startsWith("image/");
        if (isImg) {
          return `<div class="msg-img-wrap"><img src="${f.data}" alt="${escapeHtml(name)}" class="msg-img-preview" /></div>`;
        }
        return `<div class="file-chip"><div class="f-ico">${ICON.file}</div><span>${escapeHtml(name)}</span></div>`;
      }).join("");
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
      codeBtn.innerHTML = `${ICON.check}<span>Copied!</span>`;
      setTimeout(() => (codeBtn.innerHTML = `${ICON.copy}<span>Copy Code</span>`), 1500);
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

  // attachments (multimodal FileReader support)
  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files];
    for (const f of files) {
      const item = { name: f.name, type: f.type || "text/plain", size: f.size };
      if (f.type && f.type.startsWith("image/")) {
        item.data = await readFileAsDataURL(f);
      } else if (f.size < 300 * 1024) {
        item.content = await readFileAsText(f);
      }
      pendingFiles.push(item);
    }
    fileInput.value = "";
    renderAttachments();
  });

  function readFileAsDataURL(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
  }

  function renderAttachments() {
    attachmentsEl.innerHTML = pendingFiles.map((f, i) => {
      const name = typeof f === "string" ? f : f.name;
      const isImg = f.data && f.type && f.type.startsWith("image/");
      return `<div class="file-chip">
        ${isImg ? `<img src="${f.data}" class="chip-thumb" alt="" />` : `<div class="f-ico">${ICON.file}</div>`}
        <span>${escapeHtml(name)}</span>
        <button type="button" data-i="${i}" aria-label="Hapus">${ICON.x}</button>
      </div>`;
    }).join("");
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

  function stopGeneration() {
    stopRequested = true;
    if (currentAbortController) {
      try { currentAbortController.abort(); } catch (_) {}
      currentAbortController = null;
    }
  }

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
    const isSearch = $("#searchTool").classList.contains("on");
    const isThink = $("#thinkTool").classList.contains("on");
    const thinkLabel = isThink ? "Sedang bernalar" : isSearch ? "Mencari di web" : "";
    md.innerHTML = thinkLabel
      ? `<div class="thinking"><span class="shimmer">${thinkLabel}…</span></div>`
      : `<div class="thinking" aria-label="AI sedang mengetik"><span class="typing"><span></span><span></span><span></span></span></div>`;
    messagesEl.appendChild(el);
    scrollToBottom();

    setGenerating(true);
    stopRequested = false;

    if (currentAbortController) {
      try { currentAbortController.abort(); } catch (_) {}
    }
    currentAbortController = new AbortController();

    let out = "";
    let streamSuccess = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        signal: currentAbortController.signal,
        headers: {
          "Content-Type": "application/json",
          "x-gemini-key": state.apiKeys?.gemini || "",
          "x-claude-key": state.apiKeys?.claude || "",
          "x-openai-key": state.apiKeys?.openai || "",
        },
        body: JSON.stringify({
          messages: chat.messages.slice(0, -1),
          model: state.model || "Gemini 3.8 Flash",
          webSearch: isSearch,
          attachments: last.files || []
        }),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopRequested && state.currentId === chatId) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6);
              if (dataStr === "[DONE]") {
                streamSuccess = true;
                break;
              }
              try {
                const data = JSON.parse(dataStr);
                if (data.text) {
                  streamSuccess = true;
                  out += data.text;
                  reply.content = out;
                  md.innerHTML = renderMarkdown(out);
                  if (autoScroll) chatEl.scrollTop = chatEl.scrollHeight;
                }
                if (data.usage && data.usage.totalTokens) {
                  updateUsageWidget(data.usage.totalTokens);
                }
              } catch (_) {}
            }
          }
        }
      } else if (!res.ok) {
        const errText = await res.text();
        let errMsg = `HTTP ${res.status}`;
        try {
          const errObj = JSON.parse(errText);
          errMsg = errObj.error?.message || errObj.error || errMsg;
        } catch (_) {
          errMsg = errText || errMsg;
        }
        out = `> ⚠️ **Gagal Terhubung ke Backend AI (${res.status}):**\n> ${errMsg}\n\n*Pastikan GEMINI_API_KEY telah diatur di Vercel atau menu pengaturan.*`;
        reply.content = out;
        md.innerHTML = renderMarkdown(out);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        stopRequested = true;
      } else {
        out = `> ⚠️ **Kesalahan Koneksi:** Tidak dapat menjangkau server backend (\`/api/chat\`).\n> Detail: *${err.message}*\n\n*Jika menggunakan Vercel, pastikan deployment selesai dan GEMINI_API_KEY telah disetel.*`;
        reply.content = out;
        md.innerHTML = renderMarkdown(out);
      }
    } finally {
      currentAbortController = null;
    }

    reply.content = out || (stopRequested ? "_(Dihentikan)_" : "> ⚠️ Tidak ada respons dari server.");
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
          <button class="code-copy">${ICON.copy}<span>Copy Code</span></button></div>
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
  if (state.apiKeys?.gemini && profileTierEl) {
    profileTierEl.textContent = "Pro (Active)";
  }
  renderHistory();
  renderMessages();
  updateUsageWidget();
  updateSendState();
  if (!isMobile()) input.focus();
})();
