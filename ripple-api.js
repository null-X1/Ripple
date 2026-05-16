/**
 * Ripple API Server
 * Run: node ripple-api.js
 * Requires: npm install express yt-dlp-exec cors
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");

// محاولة استدعاء مكتبة yt-dlp الشاملة (تدعم يوتيوب، تيك توك، انستجرام، والمزيد)
let ytDlp;
try {
  ytDlp = require("yt-dlp-exec");
  if (ytDlp.default) ytDlp = ytDlp.default;
} catch {
  console.error("[Ripple] Missing dependency: run  npm install express yt-dlp-exec cors");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const app  = express();

app.use(cors());
app.use(express.json());

// تشغيل واجهة المستخدم من نفس المسار
app.use(express.static(path.dirname(__filename)));

// ── دوال المساعدة (Helpers) ──────────────────────────────────────────────────

// دالة لتحديد المنصة من الرابط
function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    if (host.includes("tiktok.com"))                          return "tiktok";
    if (host.includes("instagram.com"))                       return "instagram";
    if (host.includes("twitter.com") || host.includes("x.com")) return "twitter";
    if (host.includes("facebook.com") || host === "fb.watch") return "facebook";
  } catch {}
  return "generic";
}

function isValidUrl(url) {
  try { new URL(url); return true; } catch { return false; }
}

// الدالة المعدلة لمعالجة الصيغ حسب كل منصة (يوتيوب، تيك توك، انستجرام)
function buildFormats(info, platform) {
  const formats = [];
  // بعض المواقع مثل تيك توك ترجع البيانات مباشرة دون مصفوفة formats
  const availableFormats = info.formats || (info.url ? [info] : []);
  if (!availableFormats.length) return formats;

  const seen = new Set();

  // ── الفيديو مع الصوت (Combined) ──────────────────────────────────────────
  const videoFmts = availableFormats
    .filter(f => {
      const isVideo = f.ext === "mp4" || f.ext === "webm" || f.ext === "mov";
      if (!isVideo) return false;

      // منطق خاص لتيك توك وإنستجرام (نتساهل في التحقق من وجود مسار صوتي منفصل)
      if (platform === "tiktok" || platform === "instagram") {
        return f.vcodec !== "none" || f.format_note === "watermarked" || f.format_note === "direct video";
      }

      // منطق يوتيوب (يجب التأكد من دمج الصوت والصورة)
      return f.vcodec && f.vcodec !== "none" &&
             f.acodec && f.acodec !== "none" &&
             f.height;
    })
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  for (const f of videoFmts) {
    const quality = f.height ? `${f.height}p` : f.format_note || f.resolution || "video";
    const key     = `video-${quality}-${f.ext}`;
    if (!seen.has(key)) {
      seen.add(key);
      formats.push({
        id:       f.format_id || "best", // استخدام best كبديل إذا لم يتوفر ID
        type:     "video",
        label:    `Video ${quality} ${(f.ext || "").toUpperCase()}`.trim(),
        quality,
        ext:      f.ext || null,
        filesize: f.filesize || f.filesize_approx || null,
        url:      null, // التحميل يتم عبر السيرفر لتخطي حظر CORS
      });
    }
  }

  // ── الصوت فقط (Audio-only) ───────────────────────────────────────────────
  const audioFmts = availableFormats
    .filter(f =>
      f.acodec && f.acodec !== "none" &&
      (!f.vcodec || f.vcodec === "none") &&
      (f.ext === "m4a" || f.ext === "webm" || f.ext === "mp3" || f.ext === "opus")
    )
    .sort((a, b) => (b.abr || 0) - (a.abr || 0));

  let audioCount = 0;
  for (const f of audioFmts) {
    if (audioCount >= 3) break; // عرض أفضل 3 جودات صوت فقط
    const ext = f.ext || "audio";
    const abr = f.abr ? `${Math.round(f.abr)}kbps` : null;
    const key = `audio-${ext}-${abr}`;
    if (!seen.has(key)) {
      seen.add(key);
      formats.push({
        id:       f.format_id || "bestaudio",
        type:     "audio",
        label:    `Audio ${ext.toUpperCase()}${abr ? ` ${abr}` : ""}`,
        quality:  abr,
        ext,
        filesize: f.filesize || f.filesize_approx || null,
        url:      null,
      });
      audioCount++;
    }
  }

  // ── الصور المصغرة/الكوفر (لـ تيك توك وإنستجرام) ──────────────────────────
  if (
    (platform === "tiktok" || platform === "instagram") &&
    info.thumbnails && info.thumbnails.length > 0
  ) {
    formats.push({
      id:       "thumbnail",
      type:     "image",
      label:    "Cover Image",
      quality:  null,
      ext:      "jpg",
      filesize: null,
      url:      info.thumbnails[info.thumbnails.length - 1]?.url || null, // يمكن تحميل الصورة مباشرة
    });
  }

  return formats.slice(0, 12);
}

// تخصيص رسائل الخطأ للمستخدم
function mapError(message) {
  if (message.includes("Unsupported URL") || message.includes("Unable to extract"))
    return "هذا الرابط غير مدعوم. يرجى التأكد من استخدام رابط يوتيوب، تيك توك، أو إنستجرام صحيح.";
  if (message.includes("Private video") || message.includes("unavailable") || message.includes("removed"))
    return "هذا المحتوى خاص (Private) أو غير متاح.";
  if (message.includes("Sign in") || message.includes("age"))
    return "هذا المحتوى مقيد بعمر أو يتطلب تسجيل الدخول ولا يمكن تحميله.";
  return "لم نتمكن من جلب بيانات المحتوى. الرابط قد يكون غير صحيح أو المحتوى محذوف.";
}

// ── المسارات (Routes) ────────────────────────────────────────────────────────

// 1. مسار جلب معلومات الفيديو والصيغ المتاحة
app.post("/api/media/info", async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "الرابط مطلوب" });
  }
  const trimmed = url.trim();
  if (!isValidUrl(trimmed)) {
    return res.status(400).json({ error: "صيغة الرابط غير صحيحة." });
  }

  const platform = detectPlatform(trimmed);

  try {
    console.log(`[info] ${platform} — ${trimmed}`);
    // جلب البيانات الأساسية من الأداة
    const info = await ytDlp(trimmed, { dumpJson: true, noPlaylist: true });
    
    // بناء الصيغ بناءً على نوع المنصة
    const formats = buildFormats(info, platform);

    res.json({
      title:     info.title    || "بدون عنوان",
      platform,
      thumbnail: info.thumbnail || null,
      duration:  info.duration  || null,
      author:    info.uploader || info.channel || null,
      formats,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[info error] ${msg}`);
    res.status(422).json({ error: mapError(msg) });
  }
});

// 2. مسار تحميل الفيديو/الصوت وتمريره للمستخدم مباشرة
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

    // استخراج اسم الملف وامتداده
    const info = await ytDlp(url.trim(), { dumpJson: true, noPlaylist: true });
    const fmt  = info.formats?.find(f => f.format_id === format_id);
    const ext  = fmt?.ext || "mp4";
    
    // تنظيف اسم الملف من الرموز الممنوعة
    const safeTitle = (info.title || "download")
      .replace(/[^\w\s\u0600-\u06FF-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 80);
    const filename = `${safeTitle}.${ext}`;

    // إعدادات ترويسة التحميل
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Type", "application/octet-stream");

    // تشغيل التحميل وتمرير البيانات (Streaming) للمتصفح مباشرة
    const sub = ytDlp.exec(
      url.trim(),
      { format: format_id, noPlaylist: true, output: "-" },
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    // إنهاء العملية إذا أغلق المستخدم الصفحة
    req.on("close", () => sub.kill());
    
    if (sub.stdout) sub.stdout.pipe(res);
    if (sub.stderr) sub.stderr.on("data", d => console.debug("[yt-dlp]", d.toString().trim()));

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[download error] ${msg}`);
    if (!res.headersSent) res.status(422).json({ error: "فشل التحميل. قد يكون المحتوى غير متاح أو هناك مشكلة في السيرفر." });
  }
});

// ── بدء التشغيل ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Ripple API running at http://localhost:${PORT}`);
  console.log(`  Open  http://localhost:${PORT}/ripple.html  in your browser\n`);
});