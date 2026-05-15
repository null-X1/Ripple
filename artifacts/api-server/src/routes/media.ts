import { Router, type IRouter } from "express";
import ytDlpExec from "yt-dlp-exec";

const router: IRouter = Router();

type Platform = "youtube" | "tiktok" | "instagram" | "twitter" | "facebook" | "generic";

function detectPlatform(url: string): Platform {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host.includes("instagram.com")) return "instagram";
    if (host.includes("twitter.com") || host.includes("x.com")) return "twitter";
    if (host.includes("facebook.com") || host === "fb.watch") return "facebook";
    return "generic";
  } catch {
    return "generic";
  }
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

interface YtDlpFormat {
  format_id: string;
  ext: string;
  resolution?: string;
  format_note?: string;
  acodec?: string;
  vcodec?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  abr?: number;
  vbr?: number;
  height?: number;
  width?: number;
  url?: string;
}

interface YtDlpInfo {
  title?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  channel?: string;
  formats?: YtDlpFormat[];
  thumbnails?: Array<{ url: string }>;
  webpage_url?: string;
}

type MediaFormat = {
  id: string;
  type: "video" | "audio" | "image";
  label: string;
  quality: string | null;
  ext: string | null;
  filesize: number | null;
  url: string | null;
};

function buildFormats(info: YtDlpInfo, platform: Platform): MediaFormat[] {
  const formats: MediaFormat[] = [];

  if (!info.formats) return formats;

  const seen = new Set<string>();

  // Combined video+audio formats
  const videoFormats = info.formats
    .filter(
      (f) =>
        f.vcodec &&
        f.vcodec !== "none" &&
        f.acodec &&
        f.acodec !== "none" &&
        f.height &&
        (f.ext === "mp4" || f.ext === "webm" || f.ext === "mov")
    )
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  for (const f of videoFormats) {
    const quality = f.height ? `${f.height}p` : f.format_note || f.resolution || "video";
    const key = `video-${quality}-${f.ext}`;
    if (!seen.has(key)) {
      seen.add(key);
      formats.push({
        id: f.format_id,
        type: "video",
        label: `Video ${quality} ${(f.ext || "").toUpperCase()}`.trim(),
        quality,
        ext: f.ext || null,
        filesize: f.filesize || f.filesize_approx || null,
        url: platform === "tiktok" || platform === "instagram" ? (f.url || null) : null,
      });
    }
  }

  // Audio-only formats
  const audioFormats = info.formats
    .filter(
      (f) =>
        f.acodec &&
        f.acodec !== "none" &&
        (!f.vcodec || f.vcodec === "none") &&
        (f.ext === "m4a" || f.ext === "webm" || f.ext === "mp3" || f.ext === "opus")
    )
    .sort((a, b) => (b.abr || 0) - (a.abr || 0));

  let audioCount = 0;
  for (const f of audioFormats) {
    if (audioCount >= 3) break;
    const ext = f.ext || "audio";
    const abr = f.abr ? `${Math.round(f.abr)}kbps` : null;
    const key = `audio-${ext}-${abr}`;
    if (!seen.has(key)) {
      seen.add(key);
      formats.push({
        id: f.format_id,
        type: "audio",
        label: `Audio ${ext.toUpperCase()}${abr ? ` ${abr}` : ""}`,
        quality: abr,
        ext,
        filesize: f.filesize || f.filesize_approx || null,
        url: null,
      });
      audioCount++;
    }
  }

  // Thumbnails as images for TikTok/Instagram
  if (
    (platform === "tiktok" || platform === "instagram") &&
    info.thumbnails &&
    info.thumbnails.length > 0
  ) {
    formats.push({
      id: "thumbnail",
      type: "image",
      label: "Cover Image",
      quality: null,
      ext: "jpg",
      filesize: null,
      url: info.thumbnails[info.thumbnails.length - 1]?.url || null,
    });
  }

  return formats.slice(0, 12);
}

router.post("/media/info", async (req, res): Promise<void> => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  const trimmedUrl = url.trim();

  if (!isValidUrl(trimmedUrl)) {
    res.status(400).json({ error: "Invalid URL format. Please enter a valid link." });
    return;
  }

  const platform = detectPlatform(trimmedUrl);

  try {
    req.log.info({ url: trimmedUrl, platform }, "Fetching media info");

    const info = (await ytDlpExec(trimmedUrl, {
      dumpJson: true,
      noPlaylist: true,
    })) as YtDlpInfo;

    const formats = buildFormats(info, platform);

    res.json({
      title: info.title || "Unknown Title",
      platform,
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      author: info.uploader || info.channel || null,
      formats,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.warn({ url: trimmedUrl, error: message }, "Failed to fetch media info");

    if (
      message.includes("Unsupported URL") ||
      message.includes("is not a valid URL") ||
      message.includes("Unable to extract")
    ) {
      res.status(422).json({
        error: "This URL is not supported. Try a YouTube, TikTok, or Instagram link.",
      });
    } else if (
      message.includes("Private video") ||
      message.includes("unavailable") ||
      message.includes("removed")
    ) {
      res.status(422).json({ error: "This media is private or no longer available." });
    } else if (message.includes("Sign in") || message.includes("age")) {
      res.status(422).json({ error: "This content requires sign-in or is age-restricted." });
    } else {
      res.status(422).json({
        error:
          "Could not fetch media info. The URL may be invalid or the content unavailable.",
      });
    }
  }
});

// ── Direct download ──────────────────────────────────────────────────────────

router.get("/media/download", async (req, res): Promise<void> => {
  const { url, format_id } = req.query as { url?: string; format_id?: string };

  if (!url || typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "URL is required" });
    return;
  }
  if (!format_id || typeof format_id !== "string") {
    res.status(400).json({ error: "format_id is required" });
    return;
  }
  if (!isValidUrl(url.trim())) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  try {
    req.log.info({ url: url.trim(), format_id }, "Starting direct download");

    // First get info to determine filename and extension
    const info = (await ytDlpExec(url.trim(), {
      dumpJson: true,
      noPlaylist: true,
    })) as YtDlpInfo;

    const fmt = info.formats?.find((f) => f.format_id === format_id);
    const ext = fmt?.ext || "mp4";
    const safeTitle = (info.title || "download")
      .replace(/[^\w\s\u0600-\u06FF-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 80);
    const filename = `${safeTitle}.${ext}`;

    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Transfer-Encoding", "chunked");

    // Pipe yt-dlp output directly to response
    const ytDlpExecLib = await import("yt-dlp-exec");
    const ytDlp = ytDlpExecLib.default;

    const subprocess = (ytDlp as unknown as { exec: (url: string, flags: Record<string, unknown>, opts?: Record<string, unknown>) => { stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null; kill: () => void } }).exec(
      url.trim(),
      {
        format: format_id,
        noPlaylist: true,
        output: "-",
      },
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    req.on("close", () => {
      subprocess.kill();
    });

    if (subprocess.stdout) {
      subprocess.stdout.pipe(res);
    }

    if (subprocess.stderr) {
      subprocess.stderr.on("data", (chunk: Buffer) => {
        req.log.debug({ msg: chunk.toString() }, "yt-dlp stderr");
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.warn({ url, format_id, error: message }, "Download failed");
    if (!res.headersSent) {
      res.status(422).json({ error: "Download failed. The content may be unavailable." });
    }
  }
});

export default router;
