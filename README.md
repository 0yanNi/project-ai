# Full-Stack ChatGPT Ecosystem (`project-ai`)

Klon antarmuka resmi ChatGPT (HTML, CSS modern, Vanilla JS) yang terintegrasi penuh dengan backend Serverless Vercel, Real-Time SSE Streaming, Model Selector multi-tier, widget Quota & Usage live, serta konfigurasi ekosistem agen otonom Model Context Protocol (MCP).

---

## 🚀 Fitur Unggulan

### 1. Desain & Tampilan Resmi ChatGPT Dark
* **Palet Warna Presisi**:
  * Canvas background: `#212121`
  * Chat panel & composer: `#2f2f2f`
  * User bubble: abu gelap `#303030` dengan teks putih bersih `#ffffff`
  * Border halus: `#383838`
  * Tipografi: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif`
* **Floating Input Bar (`rounded-3xl`)**: Dilengkapi tombol lampiran file melingkar, chip Web Search & Reasoning, serta tombol kirim melingkar interaktif.
* **Code Block Markdown**: Dilengkapi syntax highlighting otomatis dan tombol aksi **Copy Code** dengan status transisi cepat.
* **Widget Usage & Quota**: Tersemat di bawah sidebar navigasi, menampilkan persentase kuota sesi, penghitung token live, dan indikator status *Vercel: Connected* & *GitHub: Synced*.

### 2. Backend Serverless Vercel (`/api/chat`)
* **Endpoint Streaming & Live Sync**: `POST /api/chat` berbasis Server-Sent Events (SSE) berkecepatan tinggi & `GET /api/chat` untuk sinkronisasi kuota dan session terkini.
* **Model Resmi Antigravity**:
  * 👑 **Claude Opus 5.5**: Flagship, penalaran & arsitektur kompleks terdalam.
  * ⚡ **Claude Sonnet 5.5**: SOTA coding, logic cepat & presisi tinggi.
  * 🚀 **Gemini 3.8 Flash**: Respons kilat, penalaran efisien & hemat kuota.
* **Dynamic Serverless Engine**: Mendukung koneksi langsung ke provider API (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`) serta engine cerdas bawaan yang responsif dan sadar konteks.

### 3. Ekosistem Agen & MCP (`.agents/mcp_config.json`)
* Konfigurasi konektor Model Context Protocol bawaan:
  * **GitHub MCP Connector**: Otomasi commit, issue, log cabang, dan sinkronisasi repo.
  * **Filesystem MCP Connector**: Akses pembacaan dan modifikasi kode secara mandiri.
  * **Search MCP Connector**: Grounding informasi web secara langsung.
* Dilengkapi aturan eksekusi otonom (*autonomous permissions*) untuk agentic workflow.

---

## 📂 Struktur Project

```text
project-ai/
├── .agents/
│   └── mcp_config.json    # Konfigurasi konektor MCP & Autonomous Agent
├── api/
│   └── chat.js            # Vercel Serverless Function (SSE streaming)
├── index.html             # Antarmuka ChatGPT resmi responsif
├── style.css              # Desain tema resmi ChatGPT Dark & animasinya
├── script.js              # Klien interaktif, SSE stream consumer, & storage
├── vercel.json            # Konfigurasi deployment & rewrite route Vercel
└── README.md              # Dokumentasi lengkap ekosistem
```

---

## 🛠️ Menjalankan Secara Lokal

1. **Jalankan web server sederhana**:
   ```bash
   python -m http.server 8000
   ```
   Atau menggunakan Node.js / Vercel CLI:
   ```bash
   npx vercel dev
   ```
2. Buka `http://localhost:8000` atau `http://localhost:3000` pada browser Anda.

---

## ☁️ Deployment ke Vercel

Cukup import repositori ini di dashboard [Vercel](https://vercel.com).
Opsional tambahkan Environment Variables jika ingin menyambungkan API Key pribadi:
* `GEMINI_API_KEY`
* `OPENAI_API_KEY`
* `ANTHROPIC_API_KEY`
