import type { VercelRequest, VercelResponse } from "@vercel/node";
import ytDlpExec from "yt-dlp-exec";

interface YtDlpInfo {
  title?: string;
  formats?: Array<{ format_id: string; ext: string }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url, format_id } = req.query as { url?: string; format_id?: string };

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL is required" });
  }
  if (!format_id || typeof format_id !== "string") {
    return res.status(400).json({ error: "format_id is required" });
  }

  try { new URL(url); } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    // Get filename info
    const info = (await ytDlpExec(url, {
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

    // Pipe yt-dlp download stream to response
    const ytDlp = ytDlpExec as unknown as {
      exec: (
        url: string,
        flags: Record<string, unknown>,
        opts?: Record<string, unknown>
      ) => { stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null; kill: () => void };
    };

    const subprocess = ytDlp.exec(
      url,
      { format: format_id, noPlaylist: true, output: "-" },
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    req.on("close", () => subprocess.kill());

    if (subprocess.stdout) {
      subprocess.stdout.pipe(res);
    } else {
      res.status(500).json({ error: "Could not start download stream." });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(422).json({ error: `Download failed: ${msg}` });
    }
  }
}
