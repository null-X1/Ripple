import type { VercelRequest, VercelResponse } from "@vercel/node";
import ytDlpExec from "yt-dlp-exec";

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

  // Combined video+audio
  const videoFormats = info.formats
    .filter(
      (f) =>
        f.vcodec && f.vcodec !== "none" &&
        f.acodec && f.acodec !== "none" &&
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

  // Audio-only
  const audioFormats = info.formats
    .filter(
      (f) =>
        f.acodec && f.acodec !== "none" &&
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

  // Thumbnails as images
  if (
    (platform === "tiktok" || platform === "instagram") &&
    info.thumbnails && info.thumbnails.length > 0
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url } = (req.body ?? {}) as { url?: string };

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "URL is required" });
  }

  try { new URL(url.trim()); } catch {
    return res.status(400).json({ error: "Invalid URL format." });
  }

  const trimmed = url.trim();
  const platform = detectPlatform(trimmed);

  try {
    const info = (await ytDlpExec(trimmed, {
      dumpJson: true,
      noPlaylist: true,
    })) as YtDlpInfo;

    return res.json({
      title: info.title || "Unknown Title",
      platform,
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      author: info.uploader || info.channel || null,
      formats: buildFormats(info, platform),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unsupported URL") || msg.includes("Unable to extract")) {
      return res.status(422).json({ error: "This URL is not supported. Try YouTube, TikTok, or Instagram." });
    }
    if (msg.includes("Private") || msg.includes("unavailable") || msg.includes("removed")) {
      return res.status(422).json({ error: "This media is private or no longer available." });
    }
    if (msg.includes("Sign in") || msg.includes("age")) {
      return res.status(422).json({ error: "This content requires sign-in or is age-restricted." });
    }
    return res.status(422).json({ error: "Could not fetch media info. The URL may be invalid or unavailable." });
  }
}
