/**
 * Ripple API Server — powered by Cobalt
 * Run: node ripple-api.js
 * Requires: npm install express cors
 * Node >= 18 (uses built-in fetch)
 *
 * ⚠️  api.cobalt.tools محمي بـ Turnstile ولا يعمل برمجياً.
 *    الخيارات:
 *      1. شغّل instance خاصك بـ Docker (مستحسن):
 *         https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md
 *      2. اطلب API Key من مالك instance عام واضبطه في env:
 *         COBALT_API=https://your-instance.example.com
 *         COBALT_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const https   = require("https");
const http    = require("http");

// ── إعدادات Cobalt ──────────────────────────────────────────────────────────
const COBALT_API     = (process.env.COBALT_API     || "http://localhost:9000").replace(/\/$/, "");
const COBALT_API_KEY = process.env.COBALT_API_KEY  || null;

const PORT = process.env.PORT || 3000;
const app  = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.dirname(__filename)));

// ── دوال المساعدة ────────────────────────────────────────────────────────────

function isValidUrl(url) {
  try { new URL(url); return true; } catch { return false; }
}

function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    if (host.includes("tiktok.com"))                          return "tiktok";
    if (host.includes("instagram.com"))                       return "instagram";
    if (host.includes("twitter.com") || host.includes("x.com")) return "twitter";
    if (host.includes("facebook.com") || host === "fb.watch") return "facebook";
    if (host.includes("twitch.tv"))                           return "twitch";
    if (host.includes("vimeo.com"))                           return "vimeo";
    if (host.includes("reddit.com"))                          return "reddit";
    if (host.includes("soundcloud.com"))                      return "soundcloud";
  } catch {}
  return "generic";
}

/**
 * يستدعي Cobalt API مع التحقق من Content-Type قبل JSON.parse
 */
async function callCobalt(url, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
  };

  if (COBALT_API_KEY) {
    headers["Authorization"] = `Api-Key ${COBALT_API_KEY}`;
  }

  let res;
  try {
    res = await fetch(`${COBALT_API}/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url, ...opts }),
    });
  } catch (networkErr) {
    throw new Error(
      `تعذّر الاتصال بـ Cobalt على ${COBALT_API}. تأكد أن الـ instance يعمل.\n` +
      `تفاصيل: ${networkErr.message}`
    );
  }

  // ── التحقق من Content-Type قبل JSON.parse ──────────────────────────────
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const body = await res.text();

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Cobalt يطلب مصادقة (API Key). أضف COBALT_API_KEY في متغيرات البيئة.\n" +
        "مثال: COBALT_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx node ripple-api.js"
      );
    }
    if (body.toLowerCase().includes("cloudflare") || body.toLowerCase().includes("just a moment")) {
      throw new Error(
        "الـ instance محمي بـ Cloudflare ولا يقبل طلبات برمجية مباشرة.\n" +
        "الحل: شغّل instance خاصك → https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md"
      );
    }
    throw new Error(
      `Cobalt أرجع ${res.status} مع محتوى غير JSON (${contentType || "no content-type"}).\n` +
      `أول 200 حرف: ${body.slice(0, 200)}`
    );
  }

  const json = await res.json();

  if (!res.ok && json.status !== "error") {
    throw new Error(`Cobalt HTTP ${res.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

/**
 * يبني قائمة الصيغ (presets ثابتة) حسب المنصة
 */
function buildPresets(platform) {
  const isAudioOnly = platform === "soundcloud";

  const videoPresets = isAudioOnly ? [] : [
    { id: "video_max",  type: "video", label: "Video — أفضل جودة" },
    { id: "video_1080", type: "video", label: "Video 1080p"        },
    { id: "video_720",  type: "video", label: "Video 720p"         },
    { id: "video_480",  type: "video", label: "Video 480p"         },
    { id: "video_360",  type: "video", label: "Video 360p"         },
    ...(platform === "tiktok" ? [
      { id: "video_nowm", type: "video", label: "Video بدون علامة مائية" },
    ] : []),
  ];

  const audioPresets = [
    { id: "audio_best", type: "audio", label: "Audio — أفضل جودة" },
    { id: "audio_mp3",  type: "audio", label: "Audio MP3"          },
    { id: "audio_opus", type: "audio", label: "Audio Opus"         },
    { id: "audio_wav",  type: "audio", label: "Audio WAV"          },
  ];

  return [...videoPresets, ...audioPresets];
}

/**
 * يُرجع خيارات Cobalt من format_id
 */
function resolveFormatOpts(formatId) {
  const map = {
    video_max:   { downloadMode: "auto",  videoQuality: "max"  },
    video_1080:  { downloadMode: "auto",  videoQuality: "1080" },
    video_720:   { downloadMode: "auto",  videoQuality: "720"  },
    video_480:   { downloadMode: "auto",  videoQuality: "480"  },
    video_360:   { downloadMode: "auto",  videoQuality: "360"  },
    video_nowm:  { downloadMode: "auto",  videoQuality: "max"  },
    audio_best:  { downloadMode: "audio", audioFormat:  "best" },
    audio_mp3:   { downloadMode: "audio", audioFormat:  "mp3"  },
    audio_opus:  { downloadMode: "audio", audioFormat:  "opus" },
    audio_wav:   { downloadMode: "audio", audioFormat:  "wav"  },
  };
  return map[formatId] || { downloadMode: "auto", videoQuality: "max" };
}

function mapCobaltError(code) {
  const errors = {
    "error.api.link.unsupported":    "هذا الرابط غير مدعوم من Cobalt.",
    "error.api.link.invalid":        "الرابط غير صحيح أو تالف.",
    "error.api.content.unavailable": "المحتوى غير متاح أو محذوف.",
    "error.api.content.age":         "المحتوى مقيد بعمر ولا يمكن تحميله.",
    "error.api.content.private":     "المحتوى خاص (Private).",
    "error.api.youtube.codec":       "صيغة الفيديو المطلوبة غير متوفرة على يوتيوب.",
    "error.api.rate_exceeded":       "تم تجاوز حد الطلبات. حاول بعد قليل.",
    "error.api.auth.key.invalid":    "API Key خاطئ أو منتهي الصلاحية.",
    "error.api.auth.key.missing":    "هذا الـ instance يتطلب API Key. أضف COBALT_API_KEY.",
    "error.api.auth.turnstile":      "هذا الـ instance يتطلب Turnstile — استخدم instance بدون حماية.",
  };
  return errors[code] || `خطأ من Cobalt: ${code}`;
}

// ── Proxy Helper ─────────────────────────────────────────────────────────────

function proxyFileToResponse(fileUrl, res, req, fallbackFilename = "ripple_download") {
  const protocol = fileUrl.startsWith("https") ? https : http;
  const proxyReq = protocol.get(fileUrl, proxyRes => {
    res.setHeader(
      "Content-Disposition",
      proxyRes.headers["content-disposition"] || `attachment; filename="${fallbackFilename}"`
    );
    res.setHeader("Content-Type", proxyRes.headers["content-type"] || "application/octet-stream");
    if (proxyRes.headers["content-length"])
      res.setHeader("Content-Length", proxyRes.headers["content-length"]);

    proxyRes.pipe(res);
  });

  proxyReq.on("error", err => {
    console.warn("[proxy error]", err.message);
    if (!res.headersSent)
      res.status(500).json({ error: "فشل تمرير الملف من Cobalt." });
  });

  req.on("close", () => proxyReq.destroy());
}

// ── المسارات (Routes) ────────────────────────────────────────────────────────

app.post("/api/media/info", async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "الرابط مطلوب" });

  const trimmed = url.trim();
  if (!isValidUrl(trimmed))
    return res.status(400).json({ error: "صيغة الرابط غير صحيحة." });

  const platform = detectPlatform(trimmed);

  try {
    console.log(`[info] ${platform} — ${trimmed}`);

    const probe = await callCobalt(trimmed, { downloadMode: "auto", videoQuality: "720" });

    if (probe.status === "error") {
      return res.status(422).json({
        error: probe.error?.code ? mapCobaltError(probe.error.code) : "الرابط غير مدعوم أو المحتوى غير متاح.",
      });
    }

    res.json({
      title:     `${platform.charAt(0).toUpperCase() + platform.slice(1)} Video`,
      platform,
      thumbnail: null,
      duration:  null,
      author:    null,
      formats:   buildPresets(platform),
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[info error] ${msg}`);
    res.status(422).json({ error: msg });
  }
});

app.get("/api/media/download", async (req, res) => {
  const { url, format_id } = req.query;

  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "url is required" });
  if (!format_id || typeof format_id !== "string")
    return res.status(400).json({ error: "format_id is required" });
  if (!isValidUrl(url.trim()))
    return res.status(400).json({ error: "Invalid URL" });

  try {
    console.log(`[download] format=${format_id} — ${url.trim()}`);

    const result = await callCobalt(url.trim(), resolveFormatOpts(format_id));

    if (result.status === "error") {
      return res.status(422).json({
        error: result.error?.code ? mapCobaltError(result.error.code) : "فشل التحميل من Cobalt.",
      });
    }

    if (result.status === "tunnel" || result.status === "redirect") {
      return proxyFileToResponse(result.url, res, req, result.filename || "ripple_download");
    }

    if (result.status === "picker") {
      const item = result.picker?.find(p => p.type === "video") || result.picker?.[0];
      if (!item?.url)
        return res.status(422).json({ error: "لم يتوفر رابط تحميل في نتيجة Cobalt." });
      return proxyFileToResponse(item.url, res, req, "ripple_download.mp4");
    }

    res.status(422).json({ error: `استجابة غير معروفة من Cobalt: ${result.status}` });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[download error] ${msg}`);
    if (!res.headersSent)
      res.status(422).json({ error: msg });
  }
});

// ── بدء التشغيل ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  ✦ Ripple API  →  http://localhost:${PORT}`);
  console.log(`  ✦ Cobalt      →  ${COBALT_API}`);
  console.log(`  ✦ Auth        →  ${COBALT_API_KEY ? "Api-Key ✓" : "بدون مصادقة"}`);

  if (COBALT_API.includes("api.cobalt.tools")) {
    console.warn(`
  ┌──────────────────────────────────────────────────────────────┐
  │  ⚠️  api.cobalt.tools محمي بـ Cloudflare Turnstile           │
  │  الطلبات البرمجية ستُعيد HTML بدل JSON وتفشل.               │
  │                                                              │
  │  الحل: شغّل instance محلي بـ Docker                         │
  │  https://github.com/imputnet/cobalt/blob/main/docs/          │
  │                          run-an-instance.md                  │
  │                                                              │
  │  ثم ضع في env:  COBALT_API=http://localhost:9000             │
  └──────────────────────────────────────────────────────────────┘
`);
  }

  console.log(`  Open http://localhost:${PORT}/index.html\n`);
});
