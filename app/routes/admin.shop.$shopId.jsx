import { useLoaderData, useFetcher, Link } from "react-router";
import { useState } from "react";
import {
  getSessionForShop,
  listThemes,
  deleteTheme,
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
  const formData = await request.formData();
  const intent = formData.get("intent");
  const themeId = formData.get("themeId");
  const shopDomain = decodeURIComponent(params.shopId);

  if (intent === "delete") {
    try {
      const { accessToken } = await getSessionForShop(shopDomain);
      await deleteTheme(shopDomain, accessToken, themeId);
      return { success: true, message: "Theme deleted successfully" };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  return { success: false, message: "Unknown action" };
};

const ROLE_STYLES = {
  main: { bg: "bg-green-900/50", text: "text-green-300", label: "MAIN" },
  unpublished: {
    bg: "bg-yellow-900/50",
    text: "text-yellow-300",
    label: "UNPUBLISHED",
  },
  demo: { bg: "bg-purple-900/50", text: "text-purple-300", label: "DEMO" },
};

export default function AdminShopThemes() {
  const { themes, shopDomain, key } = useLoaderData();
  const fetcher = useFetcher();
  const [confirmDelete, setConfirmDelete] = useState(null);

  const isDeleting = fetcher.state !== "idle";

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

      <h2 className="text-base font-semibold mb-4">Themes</h2>

      <div className="space-y-3">
        {themes.map((theme) => {
          const role = ROLE_STYLES[theme.role] || ROLE_STYLES.unpublished;
          const isMain = theme.role === "main";
          return (
            <div
              key={theme.id}
              className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex justify-between items-center"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-700 rounded-md flex items-center justify-center text-lg">
                  🎨
                </div>
                <div>
                  <div className="font-semibold text-slate-100">
                    {theme.name}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`${role.bg} ${role.text} px-2 py-0.5 rounded-full text-xs font-semibold`}
                    >
                      {role.label}
                    </span>
                    <span className="text-xs text-slate-500">
                      ID: {theme.id}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/admin/shop/${encodeURIComponent(shopDomain)}/themes/${theme.id}/download?key=${key}`}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-md text-sm text-slate-200 transition-colors"
                >
                  ⬇ Download
                </a>
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
          );
        })}
      </div>

      <div className="mt-4 bg-slate-800 border border-yellow-900/50 rounded-lg px-4 py-3 flex items-center gap-2">
        <span>⚠️</span>
        <span className="text-sm text-yellow-400">
          Admin mode: You are managing themes for another shop. The live theme
          cannot be deleted.
        </span>
      </div>

      {fetcher.data?.success === false && (
        <div className="mt-4 bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
          Error: {fetcher.data.message}
        </div>
      )}
    </div>
  );
}
