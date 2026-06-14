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
