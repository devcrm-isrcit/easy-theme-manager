import { useLoaderData, Link } from "react-router";
import { getAllShops, getSessionForShop, listThemes } from "../services/theme.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  const shopDomains = await getAllShops();
  const shops = [];

  for (const domain of shopDomains) {
    try {
      const { accessToken } = await getSessionForShop(domain);
      const themes = await listThemes(domain, accessToken);
      shops.push({ domain, themeCount: themes.length });
    } catch {
      shops.push({ domain, themeCount: 0, error: true });
    }
  }

  return { shops, key };
};

export default function AdminIndex() {
  const { shops, key } = useLoaderData();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Installed Shops</h1>
      <p className="text-sm text-slate-400 mb-6">
        All merchants who installed Theme Operator
      </p>

      {shops.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-8 text-center text-slate-400">
          No shops have installed the app yet.
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr] px-4 py-3 bg-slate-700/50 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <div>Shop</div>
            <div>Themes</div>
            <div className="text-right">Actions</div>
          </div>
          {shops.map((shop) => (
            <div
              key={shop.domain}
              className="grid grid-cols-[2fr_1fr_1fr] px-4 py-4 border-t border-slate-700 items-center"
            >
              <div className="font-medium text-slate-100">{shop.domain}</div>
              <div className="text-slate-400">
                {shop.error ? (
                  <span className="text-red-400">Error</span>
                ) : (
                  `${shop.themeCount} themes`
                )}
              </div>
              <div className="text-right">
                <Link
                  to={`/admin/shop/${encodeURIComponent(shop.domain)}?key=${key}`}
                  className="inline-block px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
                >
                  Manage →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
