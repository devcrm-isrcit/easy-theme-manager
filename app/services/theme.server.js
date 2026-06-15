import prisma from "../db.server";

const API_VERSION = "2025-10";

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

async function shopifyGraphql(shopDomain, accessToken, query, variables) {
  const url = shopifyRestUrl(shopDomain, "/graphql.json");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Shopify GraphQL error ${response.status}: ${text}`);
  }

  if (!response.ok) {
    throw new Error(`Shopify GraphQL error ${response.status}: ${JSON.stringify(data)}`);
  }

  if (data.errors?.length) {
    const message = data.errors.map((error) => error.message).join("; ");
    throw new Error(`Shopify GraphQL error: ${message}`);
  }

  return data.data;
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

function toThemeGid(themeId) {
  const id = String(themeId);
  return id.startsWith("gid://shopify/OnlineStoreTheme/")
    ? id
    : `gid://shopify/OnlineStoreTheme/${id}`;
}

export async function listThemes(shopDomain, accessToken) {
  const data = await shopifyFetch(shopDomain, accessToken, "/themes.json");
  return data.themes;
}

export async function getThemeAssets(shopDomain, accessToken, themeId) {
  const files = await getThemeFiles(shopDomain, accessToken, themeId);
  return files.map((file) => ({ key: file.key }));
}

export async function getThemeAsset(shopDomain, accessToken, themeId, key) {
  const files = await getThemeFiles(shopDomain, accessToken, themeId);
  const file = files.find((themeFile) => themeFile.key === key);
  if (!file) {
    throw new Error(`Theme file not found: ${key}`);
  }
  return file;
}

const THEME_FILES_QUERY = `#graphql
  query ThemeFiles($id: ID!, $first: Int!, $after: String) {
    theme(id: $id) {
      files(first: $first, after: $after) {
        nodes {
          filename
          body {
            ... on OnlineStoreThemeFileBodyText {
              content
            }
            ... on OnlineStoreThemeFileBodyBase64 {
              contentBase64
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
        userErrors {
          filename
          code
        }
      }
    }
  }
`;

function parseThemeFilesPage(data, themeId) {
  const theme = data.theme;
  if (!theme) {
    throw new Error(`Theme not found: ${themeId}`);
  }

  const userErrors = theme.files?.userErrors || [];
  if (userErrors.length) {
    const message = userErrors
      .map((error) => [error.filename, error.code].filter(Boolean).join(": "))
      .join("; ");
    throw new Error(`Failed to fetch theme files: ${message}`);
  }

  const files = [];
  for (const node of theme.files.nodes || []) {
    const file = { key: node.filename };
    if (node.body?.contentBase64 != null) {
      file.attachment = node.body.contentBase64;
    } else if (node.body?.content != null) {
      file.value = node.body.content;
    }
    files.push(file);
  }

  const cursor = theme.files.pageInfo.hasNextPage ? theme.files.pageInfo.endCursor : null;
  return { files, cursor };
}

export async function getThemeFiles(shopDomain, accessToken, themeId) {
  const files = [];
  let after = null;

  do {
    const data = await shopifyGraphql(shopDomain, accessToken, THEME_FILES_QUERY, {
      id: toThemeGid(themeId),
      first: 250,
      after,
    });
    const page = parseThemeFilesPage(data, themeId);
    files.push(...page.files);
    after = page.cursor;
  } while (after);

  return files;
}

export async function* iterateThemeFiles(shopDomain, accessToken, themeId) {
  let after = null;

  do {
    const data = await shopifyGraphql(shopDomain, accessToken, THEME_FILES_QUERY, {
      id: toThemeGid(themeId),
      first: 125,
      after,
    });
    const page = parseThemeFilesPage(data, themeId);
    for (const file of page.files) {
      yield file;
    }
    after = page.cursor;
  } while (after);
}

export async function downloadThemeAsZip(
  shopDomain,
  accessToken,
  themeId,
  themeName,
) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  const assets = await getThemeFiles(shopDomain, accessToken, themeId);

  for (const asset of assets) {
    if (asset.attachment != null) {
      zip.file(asset.key, asset.attachment, { base64: true });
    } else if (asset.value != null) {
      zip.file(asset.key, asset.value);
    }
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const safeName = themeName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return { buffer, filename: `${safeName}.zip` };
}

export async function deleteTheme(shopDomain, accessToken, themeId) {
  return shopifyDelete(shopDomain, accessToken, `/themes/${themeId}.json`);
}

export async function publishTheme(shopDomain, accessToken, themeId) {
  const url = shopifyRestUrl(shopDomain, `/themes/${themeId}.json`);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ theme: { role: "main" } }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${text}`);
  }
  return response.json();
}

export async function createTheme(shopDomain, accessToken, name) {
  const url = shopifyRestUrl(shopDomain, "/themes.json");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ theme: { name, role: "unpublished" } }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${text}`);
  }
  const data = await response.json();
  return data.theme;
}

export async function waitForThemeReady(shopDomain, accessToken, themeId, maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const data = await shopifyFetch(shopDomain, accessToken, `/themes/${themeId}.json`);
    if (data.theme && data.theme.processing === false) {
      return data.theme;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Theme is still processing after timeout. Try again later.");
}

export async function uploadThemeAsset(shopDomain, accessToken, themeId, key, value, isBase64 = false, retries = 5) {
  const url = shopifyRestUrl(shopDomain, `/themes/${themeId}/assets.json`);
  const asset = { key };
  if (isBase64) {
    asset.attachment = value;
  } else {
    asset.value = value;
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt === 0) {
      console.log(`[UPLOAD] PUT ${url} | key=${key}`);
    } else {
      console.log(`[UPLOAD RETRY ${attempt + 1}/${retries}] ${key}`);
    }

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ asset }),
    });

    if (response.ok) {
      return response.json();
    }

    const text = await response.text();
    console.log(`[UPLOAD FAIL] ${key} | status=${response.status} | body=${text}`);

    if ((response.status === 404 || response.status === 429) && attempt < retries - 1) {
      const wait = response.status === 429 ? 5000 : 3000;
      await new Promise((r) => setTimeout(r, wait * (attempt + 1)));
      continue;
    }

    throw new Error(`Failed to upload ${key}: ${response.status} ${text}`);
  }
}

export async function uploadThemeFromZip(shopDomain, accessToken, themeName, zipBuffer) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(zipBuffer);

  const theme = await createTheme(shopDomain, accessToken, themeName);

  const VALID_THEME_DIRS = ['assets', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates', 'blocks'];
  const SKIP_PATTERNS = ['__MACOSX', '.DS_Store', 'Thumbs.db', '.git/'];

  const files = [];
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    if (SKIP_PATTERNS.some(p => relativePath.includes(p))) return;
    if (relativePath.startsWith('.') || relativePath.startsWith('_')) return;

    // Strip leading folder if zip has a root wrapper (e.g. "ThemeName/assets/..." → "assets/...")
    let assetKey = relativePath;
    const firstSlash = relativePath.indexOf('/');
    if (firstSlash !== -1) {
      const firstDir = relativePath.substring(0, firstSlash);
      if (!VALID_THEME_DIRS.includes(firstDir)) {
        const rest = relativePath.substring(firstSlash + 1);
        const secondDir = rest.split('/')[0];
        if (VALID_THEME_DIRS.includes(secondDir)) {
          assetKey = rest;
        } else {
          return;
        }
      }
    }

    if (!assetKey || assetKey.startsWith('.')) return;

    files.push({ path: assetKey, file });
  });

  const textExtensions = ['.liquid', '.json', '.js', '.css', '.svg', '.txt', '.html', '.xml', '.scss'];
  let uploaded = 0;

  for (const { path, file } of files) {
    const isText = textExtensions.some(ext => path.toLowerCase().endsWith(ext));
    try {
      if (isText) {
        const content = await file.async("string");
        await uploadThemeAsset(shopDomain, accessToken, theme.id, path, content, false);
      } else {
        const content = await file.async("base64");
        await uploadThemeAsset(shopDomain, accessToken, theme.id, path, content, true);
      }
      uploaded++;
    } catch (err) {
      console.warn(`Skipping file ${path}: ${err.message}`);
    }
  }

  return { theme, filesUploaded: uploaded };
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
