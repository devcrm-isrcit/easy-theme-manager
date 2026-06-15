import { useLoaderData, useFetcher, Link } from "react-router";
import { useState, useRef, useCallback } from "react";
import {
  getSessionForShop,
  listThemes,
  deleteTheme,
  publishTheme,
} from "../services/theme.server";

export const loader = async ({ request, params }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const shopDomain = decodeURIComponent(params.shopId);

  const { accessToken } = await getSessionForShop(shopDomain);
  const themes = await listThemes(shopDomain, accessToken);

  return { themes, shopDomain, key };
};

export const action = async ({ request, params }) => {
  const shopDomain = decodeURIComponent(params.shopId);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const themeId = formData.get("themeId");

  if (intent === "delete") {
    try {
      const { accessToken } = await getSessionForShop(shopDomain);
      await deleteTheme(shopDomain, accessToken, themeId);
      return { success: true, message: "Theme deleted successfully" };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  if (intent === "publish") {
    try {
      const { accessToken } = await getSessionForShop(shopDomain);
      await publishTheme(shopDomain, accessToken, themeId);
      return { success: true, message: "Theme published successfully" };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  return { success: false, message: "Unknown action" };
};

const ROLE_STYLES = {
  main: { bg: "bg-green-900/50", text: "text-green-300", label: "MAIN" },
  unpublished: { bg: "bg-yellow-900/50", text: "text-yellow-300", label: "UNPUBLISHED" },
  demo: { bg: "bg-purple-900/50", text: "text-purple-300", label: "DEMO" },
};

function ProgressBar({ percent, color = "blue" }) {
  const colors = {
    blue: { bar: "#3b82f6", bg: "#1e293b" },
    green: { bar: "#22c55e", bg: "#1e293b" },
  };
  const c = colors[color] || colors.blue;
  return (
    <div style={{ width: "100%", height: 8, background: c.bg, borderRadius: 4, overflow: "hidden" }}>
      <div
        style={{
          width: `${percent}%`,
          height: "100%",
          background: c.bar,
          borderRadius: 4,
          transition: "width 0.2s ease",
        }}
      />
    </div>
  );
}

function FileLog({ logs }) {
  const containerRef = useRef(null);
  if (containerRef.current) {
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }
  return (
    <div
      ref={containerRef}
      style={{
        maxHeight: 160,
        overflow: "auto",
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 6,
        padding: "8px 12px",
        marginTop: 8,
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: "18px",
      }}
    >
      {logs.map((log, i) => (
        <div key={i} style={{ color: log.type === "skip" ? "#f87171" : log.type === "status" ? "#60a5fa" : "#94a3b8" }}>
          {log.type === "skip" ? "⚠ SKIP " : log.type === "status" ? "● " : "✓ "}
          {log.text}
        </div>
      ))}
    </div>
  );
}

export default function AdminShopThemes() {
  const { themes, shopDomain, key } = useLoaderData();
  const fetcher = useFetcher();
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmPublish, setConfirmPublish] = useState(null);
  const [downloadState, setDownloadState] = useState({});

  const isDeleting = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "delete";
  const isPublishing = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "publish";

  const handleDownload = useCallback(async (themeId, themeName) => {
    setDownloadState((s) => ({
      ...s,
      [themeId]: { active: true, percent: 0, status: "Connecting...", logs: [] },
    }));

    const zipChunks = [];

    try {
      const url = `/admin/shop/${encodeURIComponent(shopDomain)}/themes/${themeId}/download-stream?key=${key}`;
      const response = await fetch(url);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === "init") {
            setDownloadState((s) => ({
              ...s,
              [themeId]: {
                ...s[themeId],
                total: data.total,
                status: data.message,
                logs: [...(s[themeId]?.logs || []), { type: "status", text: data.message }],
              },
            }));
          } else if (data.type === "status") {
            setDownloadState((s) => ({
              ...s,
              [themeId]: {
                ...s[themeId],
                status: data.message,
                logs: [...(s[themeId]?.logs || []), { type: "status", text: data.message }],
              },
            }));
          } else if (data.type === "progress") {
            setDownloadState((s) => ({
              ...s,
              [themeId]: {
                ...s[themeId],
                percent: Math.round((data.fetched / Math.max(data.total, 1)) * 80),
                fetched: data.fetched,
                status: `${data.fetched} files — ${data.file}`,
                logs: [...(s[themeId]?.logs || []), { type: "file", text: data.file }],
              },
            }));
          } else if (data.type === "skip") {
            setDownloadState((s) => ({
              ...s,
              [themeId]: {
                ...s[themeId],
                logs: [...(s[themeId]?.logs || []), { type: "skip", text: `${data.file} — ${data.error}` }],
              },
            }));
          } else if (data.type === "chunk") {
            zipChunks.push(data.data);
            const chunkPercent = 80 + Math.round((data.index / Math.max(data.total, 1)) * 18);
            setDownloadState((s) => ({
              ...s,
              [themeId]: {
                ...s[themeId],
                percent: chunkPercent,
                status: `Receiving zip ${data.index + 1}/${data.total}...`,
              },
            }));
          } else if (data.type === "done") {
            setDownloadState((s) => ({
              ...s,
              [themeId]: { ...s[themeId], percent: 100, status: "Saving file..." },
            }));

            const fullBase64 = zipChunks.join("");
            const byteChars = atob(fullBase64);
            const byteArray = new Uint8Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
              byteArray[i] = byteChars.charCodeAt(i);
            }
            const blob = new Blob([byteArray], { type: "application/zip" });
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = data.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(blobUrl);

            setTimeout(() => {
              setDownloadState((s) => {
                const next = { ...s };
                delete next[themeId];
                return next;
              });
            }, 3000);
          } else if (data.type === "error") {
            setDownloadState((s) => ({
              ...s,
              [themeId]: { ...s[themeId], active: false, status: `Error: ${data.message}`, error: true },
            }));
          }
        }
      }
    } catch (err) {
      setDownloadState((s) => ({
        ...s,
        [themeId]: { ...s[themeId], active: false, status: `Error: ${err.message}`, error: true },
      }));
    }
  }, [shopDomain, key]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/admin?key=${key}`}
          className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
        >
          ← Back to shops
        </Link>
        <span className="text-slate-600">|</span>
        <h1 className="text-xl font-bold text-white">{shopDomain}</h1>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">Themes</h2>
      </div>

      <div className="space-y-3">
        {themes.map((theme) => {
          const role = ROLE_STYLES[theme.role] || ROLE_STYLES.unpublished;
          const isMain = theme.role === "main";
          const dl = downloadState[theme.id];
          return (
            <div key={theme.id} className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-slate-700 rounded-md flex items-center justify-center text-lg">
                    🎨
                  </div>
                  <div>
                    <div className="font-semibold text-slate-100">{theme.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`${role.bg} ${role.text} px-2 py-0.5 rounded-full text-xs font-semibold`}>
                        {role.label}
                      </span>
                      <span className="text-xs text-slate-500">ID: {theme.id}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownload(theme.id, theme.name)}
                    disabled={!!dl?.active}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 border border-slate-600 rounded-md text-sm text-slate-200 transition-colors"
                  >
                    {dl?.active ? "⏳ Downloading..." : "⬇ Download"}
                  </button>

                  {isMain ? null : confirmPublish === theme.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          fetcher.submit(
                            { intent: "publish", themeId: theme.id },
                            { method: "POST" },
                          );
                          setConfirmPublish(null);
                        }}
                        disabled={isPublishing}
                        className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded-md text-sm text-white transition-colors disabled:opacity-50"
                      >
                        {isPublishing ? "Publishing..." : "Confirm"}
                      </button>
                      <button
                        onClick={() => setConfirmPublish(null)}
                        className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-sm text-slate-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmPublish(theme.id)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-green-900/50 border border-green-900 rounded-md text-sm text-green-400 transition-colors"
                    >
                      🚀 Publish
                    </button>
                  )}

                  {isMain ? (
                    <button
                      disabled
                      className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-600 cursor-not-allowed"
                    >
                      🗑 Delete
                    </button>
                  ) : confirmDelete === theme.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          fetcher.submit(
                            { intent: "delete", themeId: theme.id },
                            { method: "POST" },
                          );
                          setConfirmDelete(null);
                        }}
                        disabled={isDeleting}
                        className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded-md text-sm text-white transition-colors disabled:opacity-50"
                      >
                        {isDeleting ? "Deleting..." : "Confirm"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-sm text-slate-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(theme.id)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-red-900/50 border border-red-900 rounded-md text-sm text-red-400 transition-colors"
                    >
                      🗑 Delete
                    </button>
                  )}
                </div>
              </div>

              {dl && (
                <div style={{ marginTop: 12 }}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">{dl.status}</span>
                    <span className="text-slate-500">{dl.percent || 0}%</span>
                  </div>
                  <ProgressBar percent={dl.percent || 0} color={dl.percent === 100 ? "green" : "blue"} />
                  {dl.logs?.length > 0 && <FileLog logs={dl.logs} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 bg-slate-800 border border-yellow-900/50 rounded-lg px-4 py-3 flex items-center gap-2">
        <span>⚠️</span>
        <span className="text-sm text-yellow-400">
          Admin mode: You are managing themes for another shop. The live theme cannot be deleted.
        </span>
      </div>

      {fetcher.data?.success === true && (
        <div className="mt-4 bg-green-900/30 border border-green-800 rounded-lg px-4 py-3 text-sm text-green-300">
          ✅ {fetcher.data.message}
        </div>
      )}

      {fetcher.data?.success === false && (
        <div className="mt-4 bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
          ❌ {fetcher.data.message}
        </div>
      )}
    </div>
  );
}
