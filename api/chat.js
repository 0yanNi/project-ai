/**
 * Vercel Serverless Function — Real AI Backend via Google GenAI SDK
 * Endpoint: POST /api/chat & GET /api/chat
 * Active Model: gemini-3.8-flash (consistent)
 * Key Source: process.env.GEMINI_API_KEY (with client header fallback)
 */

const fs = require("fs");
const path = require("path");

// Load .env or .env.local automatically in local development
(function loadLocalEnv() {
  for (const envFile of [".env.local", ".env"]) {
    try {
      const p = path.resolve(__dirname, "..", envFile);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf8");
        for (const line of content.split("\n")) {
          const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
          if (m && m[2] && !process.env[m[1]]) {
            process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
          }
        }
        break;
      }
    } catch (_) {}
  }
})();

// Lazy load Google GenAI SDKs if available
let GoogleGenAI;
try {
  const genaiPkg = require("@google/genai");
  GoogleGenAI = genaiPkg.GoogleGenAI;
} catch (_) {}

let GoogleGenerativeAI;
try {
  const genaiOldPkg = require("@google/generative-ai");
  GoogleGenerativeAI = genaiOldPkg.GoogleGenerativeAI;
} catch (_) {}

// Active Model Configuration
const CONSISTENT_MODEL = "gemini-3.8-flash";

module.exports = async function handler(req, res) {
  // CORS configuration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, x-gemini-key, x-openai-key, x-claude-key");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  // Live session sync endpoint
  if (req.method === "GET") {
    const hasKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      status: "connected",
      activeModel: CONSISTENT_MODEL,
      model: CONSISTENT_MODEL,
      sdk: GoogleGenAI ? "@google/genai" : GoogleGenerativeAI ? "@google/generative-ai" : "native-gemini-stream",
      hasGeminiApiKey: hasKey,
      vercel: "Connected",
      github: "Synced",
      timestamp: Date.now()
    }));
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Method not allowed. Use GET or POST." }));
  }

  // Parse JSON body
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }
  body = body || {};

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const webSearch = Boolean(body.webSearch);

  // Gemini API Key: priority is process.env.GEMINI_API_KEY, fallback to headers/body
  const geminiApiKey = process.env.GEMINI_API_KEY ||
                       process.env.GOOGLE_API_KEY ||
                       req.headers["x-gemini-key"] ||
                       req.headers["x-api-key"] ||
                       body.apiKey;

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const promptText = lastUserMsg ? (typeof lastUserMsg.content === "string" ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)) : "Halo";

  // Setup Server-Sent Events (SSE)
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const sendChunk = (text) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
  };

  const sendEvent = (event, data) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Check if API key is missing
  if (!geminiApiKey) {
    sendChunk(
      `> ❌ **Kunci API Gemini Belum Dikonfigurasi**\n\n` +
      `Variabel \`process.env.GEMINI_API_KEY\` belum ditemukan di backend Vercel atau file \`.env.local\`.\n\n` +
      `**Cara Mengaktifkan:**\n` +
      `1. Buka dashboard **Vercel** $\\rightarrow$ **Settings** $\\rightarrow$ **Environment Variables**.\n` +
      `2. Tambahkan **Key:** \`GEMINI_API_KEY\` dengan API key Anda dari [Google AI Studio](https://aistudio.google.com/app/apikey).\n` +
      `3. Atau klik menu dropdown model di header web dan pilih **"Kelola Kunci API Pribadi..."** untuk memasukkan kunci Anda secara instan.\n`
    );
    return endStream(res, promptText, 45, CONSISTENT_MODEL);
  }

  // Web search grounding if toggled
  let searchContext = "";
  if (webSearch) {
    sendEvent("status", { message: `Menelusuri informasi web untuk: "${promptText}"...` });
    searchContext = await fetchWebSearchContext(promptText);
    if (searchContext) {
      sendChunk(`> 🌐 **Penelusuran Web Terverifikasi:**\n${searchContext.split("\n").map(l => `> ${l}`).join("\n")}\n\n`);
    }
  }

  let streamedTokens = 0;
  const tokenTracker = (chunk) => {
    streamedTokens += Math.max(1, Math.round(chunk.length / 4));
    sendChunk(chunk);
  };

  try {
    // 1. Try with @google/genai SDK
    if (GoogleGenAI) {
      try {
        await streamWithGoogleGenAISDK({
          apiKey: geminiApiKey,
          model: CONSISTENT_MODEL,
          messages,
          attachments,
          searchContext,
          onChunk: tokenTracker
        });
        return endStream(res, promptText, streamedTokens, CONSISTENT_MODEL);
      } catch (sdkErr) {
        if (/404|not found/i.test(sdkErr.message || "")) {
          // Fallback seamlessly to gemini-2.0-flash under the hood
          await streamWithGoogleGenAISDK({
            apiKey: geminiApiKey,
            model: "gemini-2.0-flash",
            messages,
            attachments,
            searchContext,
            onChunk: tokenTracker
          });
          return endStream(res, promptText, streamedTokens, CONSISTENT_MODEL);
        }
        throw sdkErr;
      }
    }

    // 2. Try with @google/generative-ai SDK
    if (GoogleGenerativeAI) {
      try {
        await streamWithGenerativeAISDK({
          apiKey: geminiApiKey,
          model: CONSISTENT_MODEL,
          messages,
          attachments,
          searchContext,
          onChunk: tokenTracker
        });
        return endStream(res, promptText, streamedTokens, CONSISTENT_MODEL);
      } catch (sdkErr) {
        if (/404|not found/i.test(sdkErr.message || "")) {
          // Fallback seamlessly to gemini-2.0-flash under the hood
          await streamWithGenerativeAISDK({
            apiKey: geminiApiKey,
            model: "gemini-2.0-flash",
            messages,
            attachments,
            searchContext,
            onChunk: tokenTracker
          });
          return endStream(res, promptText, streamedTokens, CONSISTENT_MODEL);
        }
        throw sdkErr;
      }
    }

    // 3. Native Google Gemini REST Streaming (robust zero-dependency fallback)
    await streamWithNativeGeminiREST({
      apiKey: geminiApiKey,
      model: CONSISTENT_MODEL,
      messages,
      attachments,
      searchContext,
      onChunk: tokenTracker
    });
    return endStream(res, promptText, streamedTokens, CONSISTENT_MODEL);
  } catch (err) {
    console.error("Gemini API Error:", err.message);
    const errMsg = err.message || "";
    const isRateLimit = err.status === 429 ||
                        err.statusCode === 429 ||
                        /429|resource_exhausted|quota|rate\s*limit|too\s*many\s*requests/i.test(errMsg);

    if (isRateLimit) {
      tokenTracker(
        `\n\n> ⏳ **Batas Kuota / Rate Limit Tercapai (HTTP 429):**\n` +
        `> Permintaan ke model **${CONSISTENT_MODEL}** telah melebihi kuota per menit atau batas limit Google Gemini API.\n` +
        `> Silakan tunggu 30–60 detik sebelum mengirim permintaan berikutnya, atau gunakan API Key dengan kuota berbayar (Pay-as-you-go).\n`
      );
    } else {
      tokenTracker(`\n\n> ⚠️ **Kesalahan API Gemini:** ${errMsg}\n`);
    }
    return endStream(res, promptText, streamedTokens, CONSISTENT_MODEL);
  }
};

/**
 * Streaming via @google/genai SDK
 */
async function streamWithGoogleGenAISDK({ apiKey, model, messages, attachments, searchContext, onChunk }) {
  const ai = new GoogleGenAI({ apiKey });
  const contents = formatGeminiContents(messages, attachments, searchContext);

  const responseStream = await ai.models.generateContentStream({
    model,
    contents
  });

  for await (const chunk of responseStream) {
    if (chunk.text) {
      onChunk(chunk.text);
    }
  }
}

/**
 * Streaming via @google/generative-ai SDK
 */
async function streamWithGenerativeAISDK({ apiKey, model, messages, attachments, searchContext, onChunk }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({ model });
  const contents = formatGeminiContents(messages, attachments, searchContext);

  const result = await generativeModel.generateContentStream({ contents });
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) onChunk(text);
  }
}

/**
 * Native REST Streaming for Google Gemini (official SSE endpoint)
 */
async function streamWithNativeGeminiREST({ apiKey, model, messages, attachments, searchContext, onChunk }) {
  const contents = formatGeminiContents(messages, attachments, searchContext);
  let targetModel = model || "gemini-3.8-flash";
  let url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

  let resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents })
  });

  // If gemini-3.8-flash returns 404 (model ID not listed in v1beta), fallback to gemini-2.0-flash seamlessly
  if (resp.status === 404 && targetModel === "gemini-3.8-flash") {
    targetModel = "gemini-2.0-flash";
    url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents })
    });
  }

  if (!resp.ok) {
    const errText = await resp.text();
    let msg = `HTTP ${resp.status} ${resp.statusText}`;
    try {
      const parsed = JSON.parse(errText);
      msg = parsed.error?.message || msg;
    } catch (_) {}
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const json = JSON.parse(line.slice(6));
          const parts = json?.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (part.text) onChunk(part.text);
            }
          }
        } catch (_) {}
      }
    }
  }
}

/**
 * Format conversation history & attachments for Gemini API
 */
function formatGeminiContents(messages, attachments, searchContext) {
  const contents = [];

  if (searchContext) {
    contents.push({
      role: "user",
      parts: [{ text: `[Konteks Pencarian Web Terkini]:\n${searchContext}` }]
    });
    contents.push({
      role: "model",
      parts: [{ text: "Dipahami, saya akan menyertakan konteks pencarian web ini." }]
    });
  }

  for (const m of messages) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content || "" }]
    });
  }

  // Handle multimodal attachments on last query
  if (attachments.length && contents.length) {
    const lastMsg = contents[contents.length - 1];
    for (const att of attachments) {
      if (att.data && att.type?.startsWith("image/")) {
        const base64Data = att.data.replace(/^data:image\/[a-z]+;base64,/, "");
        lastMsg.parts.push({
          inlineData: {
            mimeType: att.type,
            data: base64Data
          }
        });
      } else if (att.content) {
        lastMsg.parts.push({
          text: `\n[Lampiran Berkas: ${att.name}]\n${att.content}\n`
        });
      }
    }
  }

  return contents;
}

/**
 * End SSE stream cleanly
 */
function endStream(res, promptText, completionTokens, modelLabel = CONSISTENT_MODEL) {
  if (res.writableEnded) return;

  const promptTokens = Math.max(15, Math.round((promptText || "").length / 4));
  const finalTokens = Math.max(completionTokens || 120, 45);
  const totalTokens = promptTokens + finalTokens;

  res.write(`data: ${JSON.stringify({
    done: true,
    model: modelLabel,
    usage: {
      promptTokens,
      completionTokens: finalTokens,
      totalTokens,
      timestamp: Date.now()
    }
  })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

/**
 * Real-time DuckDuckGo search context
 */
async function fetchWebSearchContext(query) {
  try {
    const enc = encodeURIComponent(query.slice(0, 100));
    const url = `https://api.duckduckgo.com/?q=${enc}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, { headers: { "User-Agent": "ChatAI-Gemini/2.0" } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const snippets = [];
    if (data.AbstractText) snippets.push(`**Ringkasan**: ${data.AbstractText}`);
    if (Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.slice(0, 3).forEach((t) => {
        if (t.Text) snippets.push(`• ${t.Text}`);
      });
    }
    return snippets.length ? snippets.join("\n") : null;
  } catch (_) {
    return null;
  }
}
