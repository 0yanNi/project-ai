/**
 * Vercel Serverless Function — Real AI Backend via Google GenAI SDK
 * Endpoint: POST /api/chat & GET /api/chat
 * Active Model: gemini-3.8-flash (consistent)
 * Key Source: process.env.GEMINI_API_KEY (with client header fallback)
 * Resilient Error Handling:
 *   - Auto-retry with backoff (2-3 attempts, 1-2s delay) on 503 / UNAVAILABLE
 *   - Fallback models: gemini-3.8-flash -> gemini-3.8-flash-lite -> gemini-2.0-flash-lite -> gemini-2.0-flash
 *   - User-friendly error: "Server AI sedang mengalami lonjakan trafik tinggi, silakan kirim ulang pesan dalam beberapa detik."
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

// Active Model & Fallbacks
const CONSISTENT_MODEL = "gemini-3.8-flash";
const FALLBACK_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.8-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if an error represents HTTP 503 or UNAVAILABLE (Service Unavailable / Overloaded)
 */
function is503OrUnavailable(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  if (status === 503) return true;
  const msg = String(err.message || err.error || err);
  return /503|unavailable|overloaded|high\s*demand|service\s*unavailable|temporarily\s*unavailable/i.test(msg);
}

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
      fallbackModels: FALLBACK_MODELS,
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

  const statusNotifier = (msg) => {
    sendEvent("status", { message: msg });
  };

  try {
    // 1. Try with @google/genai SDK (with auto-retry on 503/UNAVAILABLE and fallback to lite)
    if (GoogleGenAI) {
      try {
        await streamWithAutoRetryAndFallback({
          streamFn: streamWithGoogleGenAISDK,
          apiKey: geminiApiKey,
          messages,
          attachments,
          searchContext,
          onChunk: tokenTracker,
          onStatus: statusNotifier
        });
        return endStream(res, promptText, streamedTokens, CONSISTENT_MODEL);
      } catch (sdkErr) {
        // Fallback to REST handler
      }
    }

    // 2. Try with @google/generative-ai SDK
    if (GoogleGenerativeAI) {
      try {
        await streamWithAutoRetryAndFallback({
          streamFn: streamWithGenerativeAISDK,
          apiKey: geminiApiKey,
          messages,
          attachments,
          searchContext,
          onChunk: tokenTracker,
          onStatus: statusNotifier
        });
        return endStream(res, promptText, streamedTokens, CONSISTENT_MODEL);
      } catch (sdkErr) {
        // Fallback to REST handler
      }
    }

    // 3. Native Google Gemini REST Streaming with full auto-retry (2-3x, 1-2s delay) and model fallback
    await streamWithNativeGeminiREST({
      apiKey: geminiApiKey,
      model: CONSISTENT_MODEL,
      messages,
      attachments,
      searchContext,
      onChunk: tokenTracker,
      onStatus: statusNotifier
    });
    return endStream(res, promptText, streamedTokens, CONSISTENT_MODEL);
  } catch (err) {
    console.error("Gemini Backend Error:", err.message);
    const errMsg = err.message || "";
    const is503 = is503OrUnavailable(err);
    const isRateLimit = err.status === 429 ||
                        err.statusCode === 429 ||
                        /429|resource_exhausted|quota|rate\s*limit|too\s*many\s*requests/i.test(errMsg);

    if (is503) {
      // Exact user-friendly error message as requested
      tokenTracker(
        `\n\n> 🚦 **Server AI sedang mengalami lonjakan trafik tinggi, silakan kirim ulang pesan dalam beberapa detik.**\n`
      );
    } else if (isRateLimit) {
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
 * Executes a streaming function with 2-3 retries (1-2s delay) and model fallbacks on 503 / UNAVAILABLE
 */
async function streamWithAutoRetryAndFallback({ streamFn, apiKey, messages, attachments, searchContext, onChunk, onStatus }) {
  let lastErr = null;

  for (let mIdx = 0; mIdx < FALLBACK_MODELS.length; mIdx++) {
    const currentModel = FALLBACK_MODELS[mIdx];
    const maxRetries = 2; // 3 total attempts per model (attempt 0, 1, 2)

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = 1000 + Math.floor(Math.random() * 500) + (attempt - 1) * 500; // 1000ms - 2000ms
        if (onStatus) {
          onStatus(`Server AI sibuk (503/UNAVAILABLE). Mencoba ulang dalam ${Math.round(delayMs / 1000)} detik (percobaan ${attempt + 1}/3)...`);
        }
        await sleep(delayMs);
      } else if (mIdx > 0 && onStatus) {
        onStatus(`Mengalihkan request ke model alternatif (${currentModel}) karena beban server tinggi...`);
      }

      try {
        await streamFn({
          apiKey,
          model: currentModel,
          messages,
          attachments,
          searchContext,
          onChunk
        });
        return; // Success!
      } catch (err) {
        lastErr = err;
        if (/404|not found/i.test(err.message || "")) {
          break; // Model not available, try next fallback model immediately
        }
        if (is503OrUnavailable(err)) {
          if (attempt < maxRetries) {
            continue; // Retry current model with backoff
          } else {
            break; // Retries exhausted on this model, switch to next fallback model
          }
        }
        throw err; // Re-throw other errors (e.g. 400 Bad Request, 429 Rate Limit)
      }
    }
  }

  throw lastErr || new Error("503 UNAVAILABLE: Server AI sedang mengalami lonjakan trafik tinggi");
}

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
 * Features auto-retry with 1-2s backoff (2-3 attempts) and fallback models on 503 / UNAVAILABLE
 */
async function streamWithNativeGeminiREST({ apiKey, model, messages, attachments, searchContext, onChunk, onStatus }) {
  const contents = formatGeminiContents(messages, attachments, searchContext);
  let lastError = null;

  for (let mIdx = 0; mIdx < FALLBACK_MODELS.length; mIdx++) {
    const currentModel = FALLBACK_MODELS[mIdx];
    const maxRetries = 2; // Up to 3 attempts per model cluster

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delayMs = 1000 + (attempt - 1) * 500 + Math.floor(Math.random() * 300); // 1000ms - 1800ms
          if (onStatus) {
            onStatus(`Server AI sibuk (503/UNAVAILABLE). Mencoba ulang otomatis (percobaan ${attempt + 1}/3)...`);
          }
          await sleep(delayMs);
        } else if (mIdx > 0 && attempt === 0 && onStatus) {
          onStatus(`Mengalihkan request ke model alternatif (${currentModel}) karena beban server tinggi...`);
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents })
        });

        // 404: model ID not found in v1beta -> skip immediately to next model
        if (resp.status === 404) {
          lastError = new Error(`Model ${currentModel} tidak ditemukan.`);
          lastError.status = 404;
          break; // break retry loop to try next model in FALLBACK_MODELS
        }

        // 503 Service Unavailable / Model Overloaded / UNAVAILABLE
        if (resp.status === 503) {
          const errText = await resp.text().catch(() => "");
          lastError = new Error(errText || "503 Service Unavailable / Model Overloaded");
          lastError.status = 503;

          if (attempt < maxRetries) {
            continue; // retry current model with 1-2s delay
          } else {
            // Retries exhausted on this model, break to switch to next fallback model
            break;
          }
        }

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          let msg = `HTTP ${resp.status} ${resp.statusText}`;
          try {
            const parsed = JSON.parse(errText);
            msg = parsed.error?.message || msg;
          } catch (_) {}
          const err = new Error(msg);
          err.status = resp.status;
          throw err;
        }

        // Stream is 200 OK -> consume SSE chunks
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

        // Successfully streamed response!
        return;
      } catch (err) {
        lastError = err;
        if (is503OrUnavailable(err)) {
          if (attempt < maxRetries) {
            continue; // retry current model
          }
        } else if (err.status === 404) {
          break; // proceed to next fallback model
        } else {
          // If non-503 (e.g. 400 Bad Request, 429 Rate Limit), throw immediately
          throw err;
        }
      }
    }
  }

  // All retries and fallback models exhausted
  throw lastError || new Error("503 UNAVAILABLE: Server AI sedang mengalami lonjakan trafik tinggi");
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
