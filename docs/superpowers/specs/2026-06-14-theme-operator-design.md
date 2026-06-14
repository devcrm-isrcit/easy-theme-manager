# Theme Operator — Design Spec

## Overview

A Shopify app that lets merchants download and delete their store themes, with a separate admin panel for the app owner to manage themes across all installed shops.

## Architecture

**Unified App** — merchant and admin pages live in the same React Router app, single Vercel deployment.

- **Merchant side** (`/app/*`): Embedded in Shopify Admin, uses Polaris web components, authenticated via Shopify OAuth.
- **Admin side** (`/admin/*`): Standalone pages, uses Tailwind CSS (dark theme), authenticated via secret key in query param.

## API

**Shopify REST Admin API** (not GraphQL — GraphQL theme mutations require a Shopify exemption).

| Endpoint | Purpose | Scope |
|---|---|---|
| `GET /admin/api/2025-04/themes.json` | List all themes | `read_themes` |
| `GET /admin/api/2025-04/themes/{id}/assets.json` | List assets in a theme | `read_themes` |
| `GET /admin/api/2025-04/themes/{id}/assets.json?asset[key]=...` | Get single asset content | `read_themes` |
| `DELETE /admin/api/2025-04/themes/{id}.json` | Delete a theme | `write_themes` |

Required scope: `write_themes` (includes `read_themes`). No Shopify exemption needed.

## Authentication

### Merchant Auth
Standard Shopify OAuth via `authenticate.admin(request)` — already provided by the template.

### Admin Auth
- Environment variable: `ADMIN_SECRET_KEY`
- Access: `/admin?key=<secret>` — validated in the admin layout loader
- The key is passed through to child routes via URL search params
- Returns 401 if key is missing or doesn't match

## Routes

### Merchant Routes (Polaris, embedded)

| Route | File | Purpose |
|---|---|---|
| `/app` | `app.jsx` | Layout shell (existing) |
| `/app/_index` | `app._index.jsx` | Theme list — shows all themes with Download/Delete |
| `/app/themes/:id/download` | `app.themes.$id.download.jsx` | Action route — fetches assets, bundles .zip, returns download |

### Admin Routes (Tailwind, standalone)

| Route | File | Purpose |
|---|---|---|
| `/admin` | `admin.jsx` | Layout shell — validates secret key, renders Tailwind shell |
| `/admin/_index` | `admin._index.jsx` | Shop list dashboard — all shops that installed the app |
| `/admin/shop/:shopId` | `admin.shop.$shopId.jsx` | Theme list for a specific shop |
| `/admin/shop/:shopId/themes/:id/download` | `admin.shop.$shopId.themes.$id.download.jsx` | Download action for admin |

## Shared Service Layer

**File:** `app/services/theme.server.js`

### `listThemes(shopDomain, accessToken)`
Calls REST API `GET /themes.json`. Returns array of themes with id, name, role, updated_at.

### `getThemeAssets(shopDomain, accessToken, themeId)`
Calls REST API `GET /themes/{id}/assets.json`. Returns list of all asset keys.

### `getThemeAsset(shopDomain, accessToken, themeId, assetKey)`
Calls REST API `GET /themes/{id}/assets.json?asset[key]=...`. Returns the asset content (value or attachment for binary).

### `downloadThemeAsZip(shopDomain, accessToken, themeId, themeName)`
1. Fetch all asset keys via `getThemeAssets()`
2. Fetch each asset's content via `getThemeAsset()`
3. Bundle into a .zip using JSZip
4. Return the zip buffer and filename

### `deleteTheme(shopDomain, accessToken, themeId)`
Calls REST API `DELETE /themes/{id}.json`. Fails if the theme is the main/live theme (Shopify enforces this).

### `getAdminForShop(shopDomain)`
Loads the offline session for the given shop from Prisma DB. Returns `{ shopDomain, accessToken }` for making REST API calls.

### `getAllShops()`
Queries Prisma for all unique shops with offline sessions. Returns list of shop domains.

## UI Design

### Merchant View (Polaris)
- Page title: "Theme Manager"
- Theme list as cards: icon, theme name, role badge (Main=green, Unpublished=yellow, Demo=purple), last updated
- Download button on every theme
- Delete button: active (red) for non-main themes, disabled (gray) for the main theme
- Info banner: "The live theme cannot be deleted. Download creates a .zip of all theme files."

### Admin View (Tailwind, dark theme)
- **Shop list**: Dark slate background, table with shop domain, theme count, "Manage →" button
- **Theme management**: Same dark theme, theme cards with role badges, Download/Delete buttons
- Warning banner: "Admin mode: You are managing themes for another shop."
- Back navigation: "← Back to shops" link

## File Changes

### New Files
- `app/services/theme.server.js` — shared theme operations
- `app/routes/app.themes.$id.download.jsx` — merchant download action
- `app/routes/admin.jsx` — admin layout + auth guard
- `app/routes/admin._index.jsx` — shop list dashboard
- `app/routes/admin.shop.$shopId.jsx` — theme list for a shop
- `app/routes/admin.shop.$shopId.themes.$id.download.jsx` — admin download action
- `app/styles/admin.css` — Tailwind compiled CSS

### Modified Files
- `app/routes/app._index.jsx` — replace template demo with theme list
- `shopify.app.toml` — add `write_themes` to scopes
- `package.json` — add `jszip` and `tailwindcss` dependencies

## Constraints & Safety
- The main/live theme cannot be deleted (Shopify enforces this server-side; UI also disables the button)
- Download bundles all theme files into a `.zip` named `{theme-name}.zip`
- Admin secret key must be set as `ADMIN_SECRET_KEY` environment variable in Vercel
- REST API has rate limits — downloads fetch assets sequentially to avoid hitting limits
- Binary assets (images, fonts) are returned as base64 `attachment` field; text assets as `value` field
