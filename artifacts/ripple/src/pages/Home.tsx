import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ClipboardPaste,
  Droplets,
  Link as LinkIcon,
  Download,
  Video,
  Music,
  Image as ImageIcon,
  HardDrive,
  Copy,
  AlertCircle,
  Zap,
  Shield,
  Globe,
  Layers,
  Clock,
  Trash2,
  History,
  Phone,
  MessageCircle,
  CheckCircle,
  Languages,
} from "lucide-react";
import {
  SiYoutube,
  SiTiktok,
  SiInstagram,
  SiX,
  SiFacebook,
  SiWhatsapp,
} from "react-icons/si";
import { useFetchMediaInfo } from "@workspace/api-client-react";
import type { MediaInfo, MediaFormat } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { translations, type Lang } from "@/lib/i18n";

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined, decimals = 1) {
  if (!bytes) return null;
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function detectPlatformFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("tiktok.com")) return "tiktok";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "twitter";
  if (lower.includes("facebook.com") || lower.includes("fb.watch")) return "facebook";
  return "generic";
}

function buildDownloadUrl(mediaUrl: string, formatId: string) {
  return `/api/media/download?url=${encodeURIComponent(mediaUrl)}&format_id=${encodeURIComponent(formatId)}`;
}

// ─── platform icon ────────────────────────────────────────────────────────────

function PlatformIcon({ platform, size = 20 }: { platform: string; size?: number }) {
  switch (platform) {
    case "youtube": return <SiYoutube size={size} className="text-red-400" />;
    case "tiktok": return <SiTiktok size={size} className="text-white" />;
    case "instagram": return <SiInstagram size={size} className="text-pink-400" />;
    case "twitter": return <SiX size={size} className="text-white" />;
    case "facebook": return <SiFacebook size={size} className="text-blue-400" />;
    default: return <LinkIcon size={size} className="text-white/60" />;
  }
}

function PlatformGlowIcon({ platform }: { platform: string }) {
  const isPlatform = platform !== "generic";
  return (
    <div className="relative flex items-center justify-center w-8 h-8">
      {isPlatform && (
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.18) 45%, transparent 75%)",
            filter: "blur(3px)",
          }}
        />
      )}
      <div className="relative z-10">
        <PlatformIcon platform={platform} size={20} />
      </div>
    </div>
  );
}

// ─── history types ─────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  platform: string;
  thumbnail: string | null;
  timestamp: number;
}

const HISTORY_KEY = "ripple_history";

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 50)));
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Home() {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem("ripple_lang") as Lang) || "en";
  });
  const t = translations[lang];

  const [url, setUrl] = useState("");
  const [detectedPlatform, setDetectedPlatform] = useState("generic");
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const toggleLang = () => {
    const next: Lang = lang === "en" ? "ar" : "en";
    setLang(next);
    localStorage.setItem("ripple_lang", next);
  };

  // ── Keyboard shortcut: Ctrl+V / Cmd+V ──────────────────────────────────────
  const handleGlobalKeyDown = useCallback(
    async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        const active = document.activeElement;
        const isInInput =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement;
        if (isInInput) return; // let native paste handle it
        e.preventDefault();
        try {
          const text = await navigator.clipboard.readText();
          if (text.trim()) {
            setUrl(text.trim());
            // slight delay then submit
            setTimeout(() => {
              fetchMediaRef.current?.mutate({ data: { url: text.trim() } });
            }, 100);
          }
        } catch {
          toast({
            variant: "destructive",
            title: t.clipboardDenied,
            description: t.clipboardDeniedDesc,
          });
        }
      }
    },
    [lang] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // ── lang attr ───────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // ── fetchMedia ref (needed for Ctrl+V closure) ──────────────────────────────
  const fetchMediaRef = useRef<ReturnType<typeof useFetchMediaInfo> | null>(null);

  const fetchMedia = useFetchMediaInfo({
    mutation: {
      onSuccess: (data: MediaInfo) => {
        const entry: HistoryEntry = {
          id: Date.now().toString(),
          url,
          title: data.title,
          platform: data.platform,
          thumbnail: data.thumbnail ?? null,
          timestamp: Date.now(),
        };
        const updated = [entry, ...history.filter((h) => h.url !== url)];
        setHistory(updated);
        saveHistory(updated);
        toast({ title: t.mediaFound, description: t.mediaFoundDesc });
      },
      onError: (err: any) => {
        toast({
          variant: "destructive",
          title: t.fetchError,
          description: err.response?.data?.error || "An unexpected error occurred.",
        });
      },
    },
  });

  fetchMediaRef.current = fetchMedia;

  useEffect(() => {
    setDetectedPlatform(url ? detectPlatformFromUrl(url) : "generic");
  }, [url]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      inputRef.current?.focus();
    } catch {
      toast({
        variant: "destructive",
        title: t.clipboardDenied,
        description: t.clipboardDeniedDesc,
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    fetchMedia.mutate({ data: { url: url.trim() } });
  };

  const deleteHistoryItem = (id: string) => {
    const updated = history.filter((h) => h.id !== id);
    setHistory(updated);
    saveHistory(updated);
  };

  const clearAllHistory = () => {
    setConfirmDialog({
      message: t.clearAllConfirm,
      onConfirm: () => {
        setHistory([]);
        saveHistory([]);
        setConfirmDialog(null);
        toast({ title: t.historyCleared });
      },
    });
  };

  // ── format card ─────────────────────────────────────────────────────────────
  const renderFormatCard = (format: MediaFormat, index: number) => {
    const isDownloading = downloadingId === format.id;
    // Build direct download URL through our proxy API
    const directDownloadUrl = buildDownloadUrl(url, format.id);

    const handleDirectDownload = () => {
      setDownloadingId(format.id);
      const a = document.createElement("a");
      a.href = directDownloadUrl;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => setDownloadingId(null), 3000);
    };

    return (
      <motion.div
        key={format.id || index}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.04 }}
        className="glass-panel rounded-2xl p-4 flex flex-col justify-between gap-3"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            {format.type === "video" && <Video className="w-5 h-5 text-blue-300" />}
            {format.type === "audio" && <Music className="w-5 h-5 text-pink-300" />}
            {format.type === "image" && <ImageIcon className="w-5 h-5 text-purple-300" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-white text-sm leading-tight truncate">
              {format.label}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {format.quality && (
                <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-white/80">
                  {format.quality}
                </span>
              )}
              {format.ext && (
                <span className="text-xs text-white/50 uppercase">{format.ext}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-white/10">
          <span className="flex items-center gap-1 text-xs text-white/40">
            <HardDrive className="w-3 h-3" />
            {formatBytes(format.filesize) ?? t.unknownSize}
          </span>

          {/* Direct download for image URLs, API-proxy for video/audio */}
          {format.type === "image" && format.url ? (
            <a
              href={format.url}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-button rounded-lg px-3 py-1.5 text-xs font-medium text-white flex items-center gap-1.5"
              data-testid={`btn-download-${format.id}`}
            >
              <Download className="w-3.5 h-3.5" />
              {t.download}
            </a>
          ) : (
            <button
              onClick={handleDirectDownload}
              disabled={isDownloading}
              className="glass-button rounded-lg px-3 py-1.5 text-xs font-medium text-white flex items-center gap-1.5 disabled:opacity-60"
              data-testid={`btn-download-${format.id}`}
            >
              {isDownloading ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  {t.downloading}
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  {t.download}
                </>
              )}
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  const resultData = fetchMedia.data;

  return (
    <div
      className={`min-h-[100dvh] w-full bg-[#0f0520] relative overflow-x-hidden flex flex-col ${lang === "ar" ? "font-cairo" : "font-outfit"}`}
    >
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="bg-orb orb-1" />
        <div className="bg-orb orb-2" />
        <div className="bg-orb orb-3" />
      </div>

      {/* ── Header ── */}
      <header className="relative z-20 w-full px-6 py-5 flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-lg">
            <Droplets className="w-5 h-5 text-white" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-white">{t.appName}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Language toggle */}
          <button
            onClick={toggleLang}
            className="glass-button flex items-center gap-2 px-3 py-2 rounded-xl text-white/70 hover:text-white transition-all"
            data-testid="btn-toggle-lang"
            title={lang === "en" ? "العربية" : "English"}
          >
            <Languages className="w-4 h-4" />
            <span className="text-sm font-medium">{lang === "en" ? "ع" : "EN"}</span>
          </button>

          {/* History button */}
          <button
            onClick={() => setShowHistory(true)}
            className="relative glass-button flex items-center gap-2 px-4 py-2.5 rounded-xl text-white/80 hover:text-white transition-all"
            data-testid="btn-open-history"
          >
            <History className="w-4 h-4" />
            <span className="text-sm font-medium hidden sm:inline">{t.history}</span>
            {history.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 text-white text-[10px] font-bold flex items-center justify-center px-1.5 shadow-lg">
                {history.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* ── History Drawer ── */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div
              key="history-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 z-30"
              style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
            />
            <motion.div
              key="history-drawer"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="fixed top-0 right-0 h-full z-40 w-full max-w-sm flex flex-col"
              style={{
                background: "rgba(20, 8, 40, 0.85)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
                borderLeft: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
              }}
            >
              <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <History className="w-5 h-5 text-purple-400" />
                  <span className="text-white font-semibold text-base">{t.historyTitle}</span>
                  {history.length > 0 && (
                    <span className="bg-purple-500/40 text-white text-xs px-2 py-0.5 rounded-full">
                      {history.length}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowHistory(false)}
                  className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all"
                  data-testid="btn-close-history"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-white/40 py-16">
                    <History className="w-12 h-12 mb-4 opacity-25" />
                    <p className="text-sm text-center">{t.historyEmpty}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/8 transition-colors"
                        data-testid={`history-item-${entry.id}`}
                      >
                        {entry.thumbnail ? (
                          <img
                            src={entry.thumbnail}
                            alt=""
                            className="w-12 h-8 object-cover rounded-lg shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                            <PlatformIcon platform={entry.platform} size={14} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">{entry.title}</p>
                          <p className="text-white/40 text-xs truncate">{entry.url}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(entry.url);
                              toast({ title: t.urlCopied });
                            }}
                            className="glass-button w-7 h-7 rounded-lg flex items-center justify-center text-white/60 hover:text-white"
                            title={t.copyUrl}
                            data-testid={`btn-copy-history-${entry.id}`}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() =>
                              setConfirmDialog({
                                message: t.removeEntry,
                                onConfirm: () => {
                                  deleteHistoryItem(entry.id);
                                  setConfirmDialog(null);
                                },
                              })
                            }
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title={t.deleteEntry}
                            data-testid={`btn-delete-history-${entry.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {history.length > 0 && (
                <div className="px-4 py-4 border-t border-white/10">
                  <button
                    onClick={clearAllHistory}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm font-medium"
                    data-testid="btn-clear-history"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t.clearAll}
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Hero ── */}
      <section className="relative z-10 flex flex-col items-center text-center pt-10 pb-8 px-4">
        <motion.div
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 tracking-tight leading-tight">
            {lang === "en" ? (
              <>
                Download{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400">
                  anything
                </span>
                , anywhere
              </>
            ) : (
              <>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400">
                  حمّل
                </span>{" "}
                أي شيء، في أي مكان
              </>
            )}
          </h1>
          <p className="text-white/60 text-lg max-w-lg mx-auto">{t.subtitle}</p>

          {/* Keyboard hint */}
          <p className="mt-3 text-white/30 text-xs">{t.keyboardHint}</p>
        </motion.div>

        {/* ── URL Input ── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="w-full max-w-2xl"
        >
          <form
            onSubmit={handleSubmit}
            className="glass-panel p-2 rounded-2xl flex items-center gap-2 shadow-2xl"
          >
            <div className="px-2 flex items-center justify-center shrink-0">
              <PlatformGlowIcon platform={detectedPlatform} />
            </div>

            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t.inputPlaceholder}
                className="glass-input w-full h-12 rounded-xl px-3 pr-9 text-base placeholder:text-white/35 focus:ring-0"
                data-testid="input-url"
                dir="ltr"
              />
              <AnimatePresence>
                {url && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    type="button"
                    onClick={() => {
                      setUrl("");
                      fetchMedia.reset();
                      inputRef.current?.focus();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center text-white/70 hover:text-white transition-all"
                    data-testid="btn-clear"
                    aria-label={t.clearTooltip}
                  >
                    <X className="w-3.5 h-3.5" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            <button
              type="button"
              onClick={handlePaste}
              className="glass-button w-11 h-11 rounded-xl flex items-center justify-center text-white/70 hover:text-white shrink-0"
              title={t.pasteTooltip}
              data-testid="btn-paste"
            >
              <ClipboardPaste className="w-5 h-5" />
            </button>

            <button
              type="submit"
              disabled={!url || fetchMedia.isPending}
              className="h-11 px-6 rounded-xl bg-white text-purple-900 font-semibold shadow-lg hover:bg-pink-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0 min-w-[90px] flex items-center justify-center"
              data-testid="btn-detect"
            >
              {fetchMedia.isPending ? (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-700 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-700 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-700 animate-bounce [animation-delay:300ms]" />
                </span>
              ) : (
                t.detect
              )}
            </button>
          </form>
        </motion.div>
      </section>

      {/* ── States ── */}
      <section className="relative z-10 w-full max-w-4xl mx-auto px-4 min-h-[200px]">
        <AnimatePresence mode="wait">
          {/* Loading */}
          {fetchMedia.isPending && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16"
            >
              <div className="ripple-loader mb-6">
                <div />
                <div />
              </div>
              <h3 className="text-xl font-medium text-white mb-1">{t.analyzingTitle}</h3>
              <p className="text-white/50 text-sm">{t.analyzingSubtitle}</p>
            </motion.div>
          )}

          {/* Error */}
          {fetchMedia.isError && !fetchMedia.isPending && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="max-w-md mx-auto glass-panel p-8 rounded-3xl text-center my-8"
            >
              <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-5">
                <AlertCircle className="w-7 h-7 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{t.errorTitle}</h3>
              <p className="text-white/60 text-sm mb-6">
                {(fetchMedia.error as any)?.response?.data?.error || t.errorDefault}
              </p>
              <button
                onClick={() => {
                  setUrl("");
                  fetchMedia.reset();
                }}
                className="glass-button px-6 py-2.5 rounded-xl text-white font-medium w-full"
              >
                {t.tryAgain}
              </button>
            </motion.div>
          )}

          {/* Results */}
          {fetchMedia.isSuccess && resultData && !fetchMedia.isPending && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="w-full py-6"
            >
              <div className="glass-panel p-5 rounded-3xl mb-6 flex flex-col sm:flex-row gap-5 items-start">
                {resultData.thumbnail ? (
                  <div className="w-full sm:w-52 aspect-video rounded-2xl overflow-hidden relative shrink-0">
                    <img
                      src={resultData.thumbnail}
                      alt={resultData.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    {resultData.duration && (
                      <div className="absolute bottom-2 right-2 glass-panel px-2 py-0.5 rounded text-xs text-white font-mono">
                        {formatDuration(resultData.duration)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full sm:w-52 aspect-video rounded-2xl bg-white/5 flex items-center justify-center shrink-0">
                    <ImageIcon className="w-10 h-10 text-white/20" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="glass-panel px-3 py-1 rounded-full flex items-center gap-2">
                      <PlatformIcon platform={resultData.platform} size={14} />
                      <span className="text-xs font-medium text-white capitalize">
                        {resultData.platform}
                      </span>
                    </div>
                  </div>
                  <h2 className="text-xl font-bold text-white mb-1 line-clamp-2">
                    {resultData.title}
                  </h2>
                  {resultData.author && (
                    <p className="text-white/50 text-sm">{t.by} {resultData.author}</p>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                {(["video", "audio", "image"] as const).map((type) => {
                  const filtered = resultData.formats.filter((f) => f.type === type);
                  if (!filtered.length) return null;
                  const labels = {
                    video: t.videoFormats,
                    audio: t.audioFormats,
                    image: t.images,
                  };
                  const icons = {
                    video: <Video className="w-4 h-4 text-blue-400" />,
                    audio: <Music className="w-4 h-4 text-pink-400" />,
                    image: <ImageIcon className="w-4 h-4 text-purple-400" />,
                  };
                  return (
                    <div key={type}>
                      <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-3 flex items-center gap-2">
                        {icons[type]} {labels[type]}
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filtered.map((f, i) => renderFormatCard(f, i))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* ── Features ── */}
      <section className="relative z-10 w-full max-w-6xl mx-auto px-4 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">{t.whyTitle}</h2>
          <p className="text-white/50 text-base max-w-lg mx-auto">{t.whySubtitle}</p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            { icon: <Zap className="w-6 h-6 text-yellow-400" />, title: t.feat1Title, desc: t.feat1Desc, color: "rgba(234,179,8,0.15)" },
            { icon: <Shield className="w-6 h-6 text-green-400" />, title: t.feat2Title, desc: t.feat2Desc, color: "rgba(34,197,94,0.15)" },
            { icon: <Globe className="w-6 h-6 text-blue-400" />, title: t.feat3Title, desc: t.feat3Desc, color: "rgba(59,130,246,0.15)" },
            { icon: <Layers className="w-6 h-6 text-purple-400" />, title: t.feat4Title, desc: t.feat4Desc, color: "rgba(168,85,247,0.15)" },
            { icon: <Clock className="w-6 h-6 text-pink-400" />, title: t.feat5Title, desc: t.feat5Desc, color: "rgba(236,72,153,0.15)" },
            { icon: <CheckCircle className="w-6 h-6 text-teal-400" />, title: t.feat6Title, desc: t.feat6Desc, color: "rgba(20,184,166,0.15)" },
          ].map((feat, i) => (
            <motion.div
              key={feat.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07 }}
              className="glass-panel rounded-2xl p-6"
              style={{ background: feat.color }}
            >
              <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center mb-4">
                {feat.icon}
              </div>
              <h3 className="text-white font-semibold text-base mb-1">{feat.title}</h3>
              <p className="text-white/55 text-sm leading-relaxed">{feat.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Supported Platforms ── */}
      <section className="relative z-10 w-full max-w-5xl mx-auto px-4 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-8"
        >
          <h2 className="text-2xl font-bold text-white mb-2">{t.platformsTitle}</h2>
          <p className="text-white/40 text-sm">{t.platformsSubtitle}</p>
        </motion.div>
        <div className="flex flex-wrap items-center justify-center gap-4">
          {[
            { name: "YouTube", icon: <SiYoutube size={28} className="text-red-400" /> },
            { name: "TikTok", icon: <SiTiktok size={28} className="text-white" /> },
            { name: "Instagram", icon: <SiInstagram size={28} className="text-pink-400" /> },
            { name: "Twitter / X", icon: <SiX size={28} className="text-white" /> },
            { name: "Facebook", icon: <SiFacebook size={28} className="text-blue-400" /> },
          ].map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className="glass-panel rounded-2xl px-5 py-4 flex items-center gap-3"
            >
              {p.icon}
              <span className="text-white font-medium text-sm">{p.name}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Mobile + Desktop mockup ── */}
      <section className="relative z-10 w-full max-w-6xl mx-auto px-4 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl font-bold text-white mb-2">{t.worksEverywhereTitle}</h2>
          <p className="text-white/50 text-sm max-w-md mx-auto">{t.worksEverywhereSubtitle}</p>
        </motion.div>

        <div className="flex flex-col md:flex-row items-end justify-center gap-6">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="w-full max-w-lg"
          >
            <div className="glass-panel rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.15)" }}>
              <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border-b border-white/10">
                <div className="w-3 h-3 rounded-full bg-red-400/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-400/70" />
                <div className="w-3 h-3 rounded-full bg-green-400/70" />
                <div className="flex-1 mx-4 h-6 rounded-md bg-white/10 flex items-center px-3">
                  <span className="text-white/30 text-xs">ripple.app</span>
                </div>
              </div>
              <div className="p-5 bg-gradient-to-br from-purple-900/60 to-pink-900/40">
                <div className="text-center mb-4">
                  <div className="h-5 w-48 rounded-full bg-white/10 mx-auto mb-2" />
                  <div className="h-3 w-32 rounded-full bg-white/6 mx-auto" />
                </div>
                <div className="glass-panel rounded-xl p-3 flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full bg-red-500/50 flex items-center justify-center shrink-0">
                    <SiYoutube size={12} className="text-white" />
                  </div>
                  <div className="flex-1 h-5 rounded-md bg-white/10" />
                  <div className="w-16 h-7 rounded-lg bg-white/20" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="glass-panel rounded-xl p-3">
                      <div className="w-6 h-6 rounded-lg bg-blue-400/30 mb-2" />
                      <div className="h-2.5 rounded-full bg-white/15 mb-1" />
                      <div className="h-2 rounded-full bg-white/8 w-2/3" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-center text-white/40 text-xs mt-3">{t.desktop}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="w-48 shrink-0"
          >
            <div className="glass-panel rounded-[2rem] overflow-hidden" style={{ border: "2px solid rgba(255,255,255,0.18)" }}>
              <div className="flex justify-center pt-3 pb-1 bg-white/5">
                <div className="w-16 h-4 rounded-full bg-white/15" />
              </div>
              <div className="px-3 pb-4 pt-2 bg-gradient-to-b from-purple-900/70 to-pink-900/50 min-h-[320px]">
                <div className="flex items-center gap-1.5 mb-4">
                  <div className="w-5 h-5 rounded-md bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
                    <Droplets className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-white text-xs font-bold">{t.appName}</span>
                </div>
                <div className="text-center mb-3">
                  <div className="h-3 w-24 rounded-full bg-white/15 mx-auto mb-1" />
                  <div className="h-2 w-16 rounded-full bg-white/8 mx-auto" />
                </div>
                <div className="glass-panel rounded-xl p-2 mb-3 flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-full bg-pink-500/50 flex items-center justify-center shrink-0">
                    <SiTiktok size={8} className="text-white" />
                  </div>
                  <div className="flex-1 h-3.5 rounded bg-white/10" />
                  <div className="w-8 h-5 rounded bg-white/20" />
                </div>
                <div className="space-y-1.5">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="glass-panel rounded-lg p-2 flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-purple-400/30" />
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-white/15 mb-1" />
                        <div className="h-1.5 rounded-full bg-white/8 w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-center py-2 bg-white/5">
                <div className="w-10 h-1 rounded-full bg-white/30" />
              </div>
            </div>
            <p className="text-center text-white/40 text-xs mt-3">{t.mobile}</p>
          </motion.div>
        </div>
      </section>

      {/* ── Contact ── */}
      <section className="relative z-10 w-full max-w-4xl mx-auto px-4 pb-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-panel rounded-3xl p-8 text-center"
        >
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center mx-auto mb-5">
            <MessageCircle className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{t.contactTitle}</h2>
          <p className="text-white/50 text-sm mb-7 max-w-sm mx-auto">{t.contactSubtitle}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="tel:01070634991"
              className="glass-button flex items-center gap-2.5 px-6 py-3 rounded-xl text-white font-medium"
              data-testid="link-phone"
            >
              <Phone className="w-4 h-4 text-green-400" />
              01070634991
            </a>
            <a
              href="https://wa.me/201070634991"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-6 py-3 rounded-xl bg-green-500/20 border border-green-500/30 text-white font-medium hover:bg-green-500/30 transition-colors"
              data-testid="link-whatsapp"
            >
              <SiWhatsapp size={18} className="text-green-400" />
              WhatsApp
            </a>
          </div>
        </motion.div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 text-center pb-8 text-white/25 text-xs">
        <p>{t.footerText}</p>
      </footer>

      {/* ── Confirm Dialog ── */}
      <AnimatePresence>
        {confirmDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-panel rounded-2xl p-6 max-w-sm w-full text-center"
            >
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-white text-lg font-medium mb-6">{confirmDialog.message}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="flex-1 glass-button rounded-xl py-3 text-white/80 font-medium"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={confirmDialog.onConfirm}
                  className="flex-1 rounded-xl py-3 bg-red-500/80 text-white font-medium hover:bg-red-500 transition-colors"
                >
                  {t.delete}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
