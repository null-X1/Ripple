/**
 * Ripple API Server — powered by Cobalt
 * Run: node ripple-api.js
 * Requires: npm install express cors
 * Node >= 18 (uses built-in fetch)
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const https   = require("https");
const http    = require("http");

// ── إعدادات Cobalt ──────────────────────────────────────────────────────────
// يمكن تغيير هذا إلى instance خاص بك إن أردت
const COBALT_API = process.env.COBALT_API || "https://api.cobalt.tools";

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
 * يستدعي Cobalt API ويرجع النتيجة
 * @param {string} url  - رابط الوسائط
 * @param {object} opts - خيارات Cobalt (videoQuality, audioFormat, downloadMode...)
 */
async function callCobalt(url, opts = {}) {
  const body = JSON.stringify({ url, ...opts });

  const res = await fetch(`${COBALT_API}/`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept":        "application/json",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cobalt returned ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * يبني قائمة الصيغ المتاحة (presets ثابتة) حسب المنصة
 * كل صيغة تحمل id يُستخدم لاحقاً لاستدعاء Cobalt بالمعاملات الصحيحة
 */
function buildPresets(platform) {
  const isAudioOnly = platform === "soundcloud";

  const videoPresets = isAudioOnly ? [] : [
    { id: "video_max",  type: "video", label: "Video — أفضل جودة",  cobalt: { downloadMode: "auto", videoQuality: "max"  } },
    { id: "video_1080", type: "video", label: "Video 1080p",         cobalt: { downloadMode: "auto", videoQuality: "1080" } },
    { id: "video_720",  type: "video", label: "Video 720p",          cobalt: { downloadMode: "auto", videoQuality: "720"  } },
    { id: "video_480",  type: "video", label: "Video 480p",          cobalt: { downloadMode: "auto", videoQuality: "480"  } },
    { id: "video_360",  type: "video", label: "Video 360p",          cobalt: { downloadMode: "auto", videoQuality: "360"  } },
  ];

  const audioPresets = [
    { id: "audio_best", type: "audio", label: "Audio — أفضل جودة",  cobalt: { downloadMode: "audio", audioFormat: "best" } },
    { id: "audio_mp3",  type: "audio", label: "Audio MP3",           cobalt: { downloadMode: "audio", audioFormat: "mp3"  } },
    { id: "audio_opus", type: "audio", label: "Audio Opus",          cobalt: { downloadMode: "audio", audioFormat: "opus" } },
    { id: "audio_wav",  type: "audio", label: "Audio WAV",           cobalt: { downloadMode: "audio", audioFormat: "wav"  } },
  ];

  // تيك توك: نضيف خيار بدون علامة مائية
  const tiktokExtra = platform === "tiktok" ? [
    { id: "video_nowm", type: "video", label: "Video بدون علامة مائية", cobalt: { downloadMode: "auto", videoQuality: "max", tiktokH265: false } },
  ] : [];

  return [...videoPresets, ...tiktokExtra, ...audioPresets];
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
    "error.api.fetch.short":         "تعذّر استخراج الرابط القصير.",
    "error.api.content.age":         "المحتوى مقيد بعمر ولا يمكن تحميله.",
    "error.api.content.private":     "المحتوى خاص (Private).",
    "error.api.youtube.codec":       "صيغة الفيديو المطلوبة غير متوفرة على يوتيوب.",
    "error.api.rate_exceeded":       "تم تجاوز حد الطلبات. حاول بعد قليل.",
  };
  return errors[code] || `خطأ من Cobalt: ${code}`;
}

// ── المسارات (Routes) ────────────────────────────────────────────────────────

/**
 * 1. جلب معلومات الوسائط والصيغ المتاحة
 *    لا يستدعي Cobalt هنا — يرجع presets ثابتة لتسريع الاستجابة
 *    ويتحقق من صحة الرابط فقط
 */
app.post("/api/media/info", async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "الرابط مطلوب" });

  const trimmed = url.trim();
  if (!isValidUrl(trimmed))
    return res.status(400).json({ error: "صيغة الرابط غير صحيحة." });

  const platform = detectPlatform(trimmed);

  // اختبار سريع أن Cobalt يقبل الرابط قبل إرجاع النتيجة
  try {
    console.log(`[info] ${platform} — ${trimmed}`);

    const probe = await callCobalt(trimmed, {
      downloadMode: "auto",
      videoQuality: "720",
    });

    // إذا رجع خطأ من Cobalt نُعيده مباشرة
    if (probe.status === "error") {
      const msg = probe.error?.code
        ? mapCobaltError(probe.error.code)
        : "الرابط غير مدعوم أو المحتوى غير متاح.";
      return res.status(422).json({ error: msg });
    }

    // استخراج عنوان من picker إن وُجد (اختياري)
    let title = null;
    if (probe.status === "picker" && probe.picker?.[0]) {
      // Cobalt لا يرجع عنواناً مباشرة — نستخدم اسم المنصة كبديل
    }

    res.json({
      title:     title || `${platform.charAt(0).toUpperCase() + platform.slice(1)} Video`,
      platform,
      thumbnail: null,        // Cobalt لا يرجع thumbnail في مرحلة الـ probe
      duration:  null,
      author:    null,
      formats:   buildPresets(platform),
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[info error] ${msg}`);
    res.status(422).json({ error: "تعذّر التواصل مع Cobalt. تأكد من الرابط أو حاول مجدداً." });
  }
});

/**
 * 2. تحميل الملف وتمريره للمستخدم
 *    يستدعي Cobalt بالمعاملات الصحيحة ثم يُعيد التوجيه أو يُمرّر stream
 */
app.get("/api/media/download", async (req, res) => {
  const { url, format_id } = req.query;

  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "url is required" });
  if (!format_id || typeof format_id !== "string")
    return res.status(400).json({ error: "format_id is required" });
  if (!isValidUrl(url.trim()))
    return res.status(400).json({ error: "Invalid URL" });

  const cobaltOpts = resolveFormatOpts(format_id);

  try {
    console.log(`[download] format=${format_id} opts=${JSON.stringify(cobaltOpts)} — ${url.trim()}`);

    const result = await callCobalt(url.trim(), cobaltOpts);

    if (result.status === "error") {
      const msg = result.error?.code
        ? mapCobaltError(result.error.code)
        : "فشل التحميل من Cobalt.";
      return res.status(422).json({ error: msg });
    }

    // ── حالة tunnel أو redirect: رابط مباشر واحد ──
    if (result.status === "tunnel" || result.status === "redirect") {
      const fileUrl = result.url;

      // نُمرّر Stream عبر السيرفر لتفادي مشاكل CORS في المتصفح
      const protocol = fileUrl.startsWith("https") ? https : http;
      const proxyReq = protocol.get(fileUrl, proxyRes => {
        // نُمرّر الترويسات كما هي
        const contentDisposition = proxyRes.headers["content-disposition"]
          || `attachment; filename="ripple_download"`;
        const contentType = proxyRes.headers["content-type"]
          || "application/octet-stream";

        res.setHeader("Content-Disposition", contentDisposition);
        res.setHeader("Content-Type",        contentType);
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
      return;
    }

    // ── حالة picker: مجموعة ملفات (مثلاً تيك توك بالعلامة المائية وبدونها) ──
    if (result.status === "picker") {
      // نختار أول ملف فيديو متاح
      const item = result.picker?.find(p => p.type === "video") || result.picker?.[0];
      if (!item?.url)
        return res.status(422).json({ error: "لم يتوفر رابط تحميل في نتيجة Cobalt." });

      const protocol = item.url.startsWith("https") ? https : http;
      const proxyReq = protocol.get(item.url, proxyRes => {
        res.setHeader("Content-Disposition", 'attachment; filename="ripple_download.mp4"');
        res.setHeader("Content-Type", proxyRes.headers["content-type"] || "application/octet-stream");
        if (proxyRes.headers["content-length"])
          res.setHeader("Content-Length", proxyRes.headers["content-length"]);
        proxyRes.pipe(res);
      });

      proxyReq.on("error", err => {
        console.warn("[proxy error]", err.message);
        if (!res.headersSent)
          res.status(500).json({ error: "فشل تمرير الملف." });
      });

      req.on("close", () => proxyReq.destroy());
      return;
    }

    // حالة غير متوقعة
    res.status(422).json({ error: `استجابة غير معروفة من Cobalt: ${result.status}` });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[download error] ${msg}`);
    if (!res.headersSent)
      res.status(422).json({ error: "فشل التحميل. قد يكون المحتوى غير متاح أو هناك مشكلة في السيرفر." });
  }
});

// ── بدء التشغيل ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Ripple API running at http://localhost:${PORT}`);
  console.log(`  Cobalt instance : ${COBALT_API}`);
  console.log(`  Open http://localhost:${PORT}/index.html in your browser\n`);
});
