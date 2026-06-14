# Theme Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Shopify app that lets merchants download/delete their themes, with an admin panel for the app owner to manage themes across all shops.

**Architecture:** Unified React Router app — merchant pages at `/app/*` (Polaris, Shopify OAuth) and admin pages at `/admin/*` (Tailwind CSS, secret key auth). Shared service layer for Shopify REST API theme operations. Single Vercel deployment.

**Tech Stack:** React Router 7, Prisma/SQLite, Shopify REST Admin API, JSZip (already installed), Tailwind CSS (CDN for admin).

---

## File Structure

| File | Responsibility |
|---|---|
| `app/services/theme.server.js` | All Shopify REST API calls for themes — list, get assets, download as zip, delete. Also session lookup for admin cross-shop access. |
| `app/routes/app._index.jsx` | Merchant theme list page (modify existing). Polaris web components. |
| `app/routes/app.themes.$id.download.jsx` | Merchant download action — returns .zip file response. |
| `app/routes/admin.jsx` | Admin layout shell — secret key auth, Tailwind CDN link, nav header. |
| `app/routes/admin._index.jsx` | Admin shop list dashboard — lists all installed shops. |
| `app/routes/admin.shop.$shopId.jsx` | Admin theme management — lists themes for a specific shop. |
| `app/routes/admin.shop.$shopId.themes.$id.download.jsx` | Admin download action — returns .zip for a specific shop's theme. |
| `shopify.app.toml` | Add `write_themes` scope. |

---

### Task 1: Add `write_themes` Scope

**Files:**
- Modify: `shopify.app.toml:9-10`

- [ ] **Step 1: Update scopes in shopify.app.toml**

Change the scopes line to include `write_themes`:

```toml
scopes = "write_products,write_metaobjects,write_metaobject_definitions,write_themes"
```

- [ ] **Step 2: Verify the change**

Run: `grep scopes shopify.app.toml`
Expected: The line should show `write_themes` in the scopes list.

- [ ] **Step 3: Commit**

```bash
git add shopify.app.toml
git commit -m "feat: add write_themes scope for theme management"
```

---

### Task 2: Shared Theme Service Layer

**Files:**
- Create: `app/services/theme.server.js`

- [ ] **Step 1: Create the theme service file**

```javascript
import prisma from "../db.server";

const API_VERSION = "2025-04";

function shopifyRestUrl(shopDomain, path) {
  return `https://${shopDomain}/admin/api/${API_VERSION}${path}`;
}

async function shopifyFetch(shopDomain, accessToken, path) {
  const url = shopifyRestUrl(shopDomain, path);
  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${text}`);
  }
  return response.json();
}

async function shopifyDelete(shopDomain, accessToken, path) {
  const url = shopifyRestUrl(shopDomain, path);
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "X-Shopify-Access-Token": accessToken,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${text}`);
  }
  return true;
}

export async function listThemes(shopDomain, accessToken) {
  const data = await shopifyFetch(shopDomain, accessToken, "/themes.json");
  return data.themes;
}

export async function getThemeAssets(shopDomain, accessToken, themeId) {
  const data = await shopifyFetch(
    shopDomain,
    accessToken,
    `/themes/${themeId}/assets.json`,
  );
  return data.assets;
}

export async function getThemeAsset(shopDomain, accessToken, themeId, key) {
  const data = await shopifyFetch(
    shopDomain,
    accessToken,
    `/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`,
  );
  return data.asset;
}

export async function downloadThemeAsZip(
  shopDomain,
  accessToken,
  themeId,
  themeName,
) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  const assets = await getThemeAssets(shopDomain, accessToken, themeId);

  for (const asset of assets) {
    const full = await getThemeAsset(
      shopDomain,
      accessToken,
      themeId,
      asset.key,
    );
    if (full.attachment) {
      zip.file(full.key, full.attachment, { base64: true });
    } else if (full.value) {
      zip.file(full.key, full.value);
    }
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const safeName = themeName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return { buffer, filename: `${safeName}.zip` };
}

export async function deleteTheme(shopDomain, accessToken, themeId) {
  return shopifyDelete(shopDomain, accessToken, `/themes/${themeId}.json`);
}

export async function getAllShops() {
  const sessions = await prisma.session.findMany({
    where: { isOnline: false },
    select: { shop: true },
    distinct: ["shop"],
  });
  return sessions.map((s) => s.shop);
}

export async function getSessionForShop(shopDomain) {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
    orderBy: { expires: "desc" },
  });
  if (!session) {
    throw new Error(`No session found for shop: ${shopDomain}`);
  }
  return { shop: session.shop, accessToken: session.accessToken };
}
```

- [ ] **Step 2: Verify the file loads without syntax errors**

Run: `cd "/Users/chintan/Shopify Functions/Shopify Apps/theme-operator" && node -e "import('./app/services/theme.server.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: Either "OK" or a Prisma-related error (fine — means syntax is valid).

- [ ] **Step 3: Commit**

```bash
git add app/services/theme.server.js
git commit -m "feat: add shared theme service layer for REST API operations"
```

---

### Task 3: Merchant Theme List Page

**Files:**
- Modify: `app/routes/app._index.jsx`

- [ ] **Step 1: Replace the template demo with the theme list page**

Replace the entire contents of `app/routes/app._index.jsx` with:

```jsx
import { useEffect, useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listThemes } from "../services/theme.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const themes = await listThemes(session.shop, session.accessToken);
  return { themes };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const themeId = formData.get("themeId");

  if (intent === "delete") {
    const { deleteTheme } = await import("../services/theme.server");
    try {
      await deleteTheme(session.shop, session.accessToken, themeId);
      return { success: true, message: "Theme deleted successfully" };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  return { success: false, message: "Unknown action" };
};

export default function ThemeManager() {
  const { themes } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(fetcher.data.message);
      setConfirmDelete(null);
    } else if (fetcher.data?.success === false) {
      shopify.toast.show(fetcher.data.message, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const isDeleting =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "delete";

  const roleBadge = (role) => {
    const styles = {
      main: {
        background: "#e0f5e9",
        color: "#1a7f37",
        label: "MAIN",
      },
      unpublished: {
        background: "#fff3cd",
        color: "#856404",
        label: "UNPUBLISHED",
      },
      demo: {
        background: "#e8defc",
        color: "#6b21a8",
        label: "DEMO",
      },
    };
    const s = styles[role] || styles.unpublished;
    return s;
  };

  return (
    <s-page heading="Theme Manager">
      <s-section>
        <s-paragraph>
          Download or delete your store themes. The live theme cannot be deleted.
        </s-paragraph>
      </s-section>

      <s-section>
        {themes.map((theme) => {
          const badge = roleBadge(theme.role);
          const isMain = theme.role === "main";
          return (
            <s-box
              key={theme.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
              style={{ marginBottom: "12px" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <div>
                    <s-text fontWeight="bold">{theme.name}</s-text>
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        marginTop: "4px",
                      }}
                    >
                      <span
                        style={{
                          background: badge.background,
                          color: badge.color,
                          padding: "2px 8px",
                          borderRadius: "10px",
                          fontSize: "11px",
                          fontWeight: 600,
                        }}
                      >
                        {badge.label}
                      </span>
                      <s-text variant="subdued" fontSize="small">
                        Updated{" "}
                        {new Date(theme.updated_at).toLocaleDateString()}
                      </s-text>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <s-button
                    href={`/app/themes/${theme.id}/download`}
                    download
                    variant="secondary"
                  >
                    Download
                  </s-button>
                  {isMain ? (
                    <s-button disabled variant="secondary">
                      Delete
                    </s-button>
                  ) : confirmDelete === theme.id ? (
                    <div style={{ display: "flex", gap: "4px" }}>
                      <s-button
                        variant="destructive"
                        onClick={() => {
                          fetcher.submit(
                            { intent: "delete", themeId: theme.id },
                            { method: "POST" },
                          );
                        }}
                        {...(isDeleting ? { loading: true } : {})}
                      >
                        Confirm
                      </s-button>
                      <s-button
                        variant="secondary"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </s-button>
                    </div>
                  ) : (
                    <s-button
                      variant="destructive"
                      onClick={() => setConfirmDelete(theme.id)}
                    >
                      Delete
                    </s-button>
                  )}
                </div>
              </div>
            </s-box>
          );
        })}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Verify the app loads**

Run: `cd "/Users/chintan/Shopify Functions/Shopify Apps/theme-operator" && npm run dev`
Open the app in Shopify Admin. Verify the theme list page renders with themes.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app._index.jsx
git commit -m "feat: replace template demo with merchant theme list page"
```

---

### Task 4: Merchant Download Action Route

**Files:**
- Create: `app/routes/app.themes.$id.download.jsx`

- [ ] **Step 1: Create the download action route**

```jsx
import { authenticate } from "../shopify.server";
import { downloadThemeAsZip, listThemes } from "../services/theme.server";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const themeId = params.id;

  const themes = await listThemes(session.shop, session.accessToken);
  const theme = themes.find((t) => String(t.id) === String(themeId));
  const themeName = theme?.name || `theme-${themeId}`;

  const { buffer, filename } = await downloadThemeAsZip(
    session.shop,
    session.accessToken,
    themeId,
    themeName,
  );

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
```

- [ ] **Step 2: Test the download**

Open the app in Shopify Admin, click "Download" on any theme. A `.zip` file should download containing all theme files.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.themes.\$id.download.jsx
git commit -m "feat: add merchant theme download action route"
```

---

### Task 5: Admin Layout with Secret Key Auth

**Files:**
- Create: `app/routes/admin.jsx`

- [ ] **Step 1: Create the admin layout shell**

```jsx
import { Outlet, useLoaderData, Link, useSearchParams } from "react-router";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const secret = process.env.ADMIN_SECRET_KEY;

  if (!secret || key !== secret) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return { key };
};

export default function AdminLayout() {
  const { key } = useLoaderData();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Theme Operator Admin</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `tailwind.config = {
              theme: {
                extend: {
                  colors: {
                    slate: {
                      850: '#172033',
                    }
                  }
                }
              }
            }`,
          }}
        />
      </head>
      <body className="bg-slate-950 text-slate-200 min-h-screen">
        <nav className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-white">
              Theme Operator
            </span>
            <span className="text-xs text-slate-500">Admin</span>
          </div>
          <div className="text-xs text-slate-500">Logged in as Admin</div>
        </nav>
        <main className="max-w-5xl mx-auto px-6 py-8">
          <Outlet context={{ key }} />
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Add `ADMIN_SECRET_KEY` to your environment**

Add to your `.env` file (or Vercel env vars):
```
ADMIN_SECRET_KEY=your-secret-key-here
```

- [ ] **Step 3: Test the auth guard**

Visit `/admin` without a key — should see 401.
Visit `/admin?key=wrong` — should see 401.
Visit `/admin?key=your-secret-key-here` — should see the admin shell (empty content area for now).

- [ ] **Step 4: Commit**

```bash
git add app/routes/admin.jsx
git commit -m "feat: add admin layout with secret key authentication"
```

---

### Task 6: Admin Shop List Dashboard

**Files:**
- Create: `app/routes/admin._index.jsx`

- [ ] **Step 1: Create the shop list page**

```jsx
import { useLoaderData, Link, useOutletContext } from "react-router";
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
```

- [ ] **Step 2: Test the shop list**

Visit `/admin?key=your-secret-key-here`. Should see a list of shops with theme counts and "Manage" links.

- [ ] **Step 3: Commit**

```bash
git add app/routes/admin._index.jsx
git commit -m "feat: add admin shop list dashboard"
```

---

### Task 7: Admin Theme Management Page

**Files:**
- Create: `app/routes/admin.shop.$shopId.jsx`

- [ ] **Step 1: Create the admin theme management page**

```jsx
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
```

- [ ] **Step 2: Test the admin theme page**

Click "Manage →" on a shop from the admin dashboard. Should see the shop's themes with Download/Delete buttons. Delete should be disabled for the main theme.

- [ ] **Step 3: Commit**

```bash
git add app/routes/admin.shop.\$shopId.jsx
git commit -m "feat: add admin theme management page for individual shops"
```

---

### Task 8: Admin Download Action Route

**Files:**
- Create: `app/routes/admin.shop.$shopId.themes.$id.download.jsx`

- [ ] **Step 1: Create the admin download action route**

```jsx
import {
  getSessionForShop,
  listThemes,
  downloadThemeAsZip,
} from "../../services/theme.server";

export const loader = async ({ request, params }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const secret = process.env.ADMIN_SECRET_KEY;

  if (!secret || key !== secret) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const shopDomain = decodeURIComponent(params.shopId);
  const themeId = params.id;

  const { accessToken } = await getSessionForShop(shopDomain);
  const themes = await listThemes(shopDomain, accessToken);
  const theme = themes.find((t) => String(t.id) === String(themeId));
  const themeName = theme?.name || `theme-${themeId}`;

  const { buffer, filename } = await downloadThemeAsZip(
    shopDomain,
    accessToken,
    themeId,
    themeName,
  );

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
```

- [ ] **Step 2: Test the admin download**

From the admin theme management page, click "Download" on any theme. A `.zip` file should download.

- [ ] **Step 3: Commit**

```bash
git add app/routes/admin.shop.\$shopId.themes.\$id.download.jsx
git commit -m "feat: add admin theme download action route"
```

---

### Task 9: Update App Navigation

**Files:**
- Modify: `app/routes/app.jsx:18-20`

- [ ] **Step 1: Update the app nav to remove the "Additional page" link**

In `app/routes/app.jsx`, replace the `<s-app-nav>` section:

```jsx
<s-app-nav>
  <s-link href="/app">Themes</s-link>
</s-app-nav>
```

- [ ] **Step 2: Remove the additional page route file**

```bash
rm app/routes/app.additional.jsx
```

- [ ] **Step 3: Verify navigation works**

Open the app in Shopify Admin. The nav should show only "Themes" and load the theme list.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.jsx
git rm app/routes/app.additional.jsx
git commit -m "feat: update nav to show Themes, remove template additional page"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Verify merchant flow**

1. Open the app in Shopify Admin
2. See theme list with role badges
3. Click "Download" on a theme — `.zip` downloads with all theme files
4. Click "Delete" on a non-main theme → click "Confirm" → theme deleted
5. Verify delete button is disabled for the main theme

- [ ] **Step 2: Verify admin flow**

1. Visit `/admin?key=YOUR_SECRET` — see shop list
2. Click "Manage →" on a shop — see that shop's themes
3. Download a theme — `.zip` downloads
4. Delete a non-main theme — works
5. Verify "← Back to shops" navigates back with key preserved

- [ ] **Step 3: Verify auth guard**

1. Visit `/admin` without key — 401
2. Visit `/admin?key=wrong` — 401

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: theme operator app complete — merchant + admin panel"
```
