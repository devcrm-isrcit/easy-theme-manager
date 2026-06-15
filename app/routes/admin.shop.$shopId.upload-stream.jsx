import {
  getSessionForShop,
  createTheme,
  uploadThemeAsset,
  waitForThemeReady,
} from "../services/theme.server";

const VALID_THEME_DIRS = ["assets", "config", "layout", "locales", "sections", "snippets", "templates", "blocks"];
const SKIP_PATTERNS = ["__MACOSX", ".DS_Store", "Thumbs.db", ".git/"];
const TEXT_EXTENSIONS = [".liquid", ".json", ".js", ".css", ".svg", ".txt", ".html", ".xml", ".scss"];

function getAssetKey(relativePath) {
  if (SKIP_PATTERNS.some((p) => relativePath.includes(p))) return null;

  const parts = relativePath.split("/").filter(Boolean);

  // Strip all leading non-theme folders (e.g. "MyTheme/v2/assets/file.js" → "assets/file.js")
  while (parts.length > 1 && !VALID_THEME_DIRS.includes(parts[0])) {
    parts.shift();
  }

  if (parts.length === 0) return null;
  if (!VALID_THEME_DIRS.includes(parts[0])) return null;

  const filename = parts[parts.length - 1];
  if (filename.startsWith(".") || filename.startsWith("_")) return null;

  return parts.join("/");
}

export const action = async ({ request, params }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const secret = process.env.ADMIN_SECRET_KEY;

  if (!secret || key !== secret) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const shopDomain = decodeURIComponent(params.shopId);
  const formData = await request.formData();
  const themeName = formData.get("themeName");
  const rawFiles = formData.getAll("files");
  const rawPaths = formData.getAll("paths");

  if (!rawFiles.length || !themeName) {
    return Response.json({ error: "Theme name and files required" }, { status: 400 });
  }

  // Build file list with asset keys
  const files = [];
  for (let i = 0; i < rawFiles.length; i++) {
    const relativePath = rawPaths[i] || rawFiles[i].name;
    const assetKey = getAssetKey(relativePath);
    if (assetKey) {
      files.push({ assetKey, file: rawFiles[i] });
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const total = files.length;
        send({ type: "init", total, message: `Found ${total} theme files to upload` });

        if (total === 0) {
          send({ type: "error", message: "No valid Shopify theme files found. Select a folder containing assets, config, layout, locales, sections, snippets, templates, or blocks." });
          return;
        }

        const { accessToken } = await getSessionForShop(shopDomain);
        send({ type: "status", message: `Creating theme "${themeName}"...` });
        const theme = await createTheme(shopDomain, accessToken, themeName);
        send({ type: "status", message: `Theme created (ID: ${theme.id}). Waiting for Shopify to finish processing...` });

        await waitForThemeReady(shopDomain, accessToken, theme.id);
        send({ type: "status", message: "Theme ready. Starting file uploads..." });

        let uploaded = 0;
        let skipped = 0;

        for (const { assetKey, file } of files) {
          const isText = TEXT_EXTENSIONS.some((ext) => assetKey.toLowerCase().endsWith(ext));
          try {
            if (isText) {
              const content = await file.text();
              await uploadThemeAsset(shopDomain, accessToken, theme.id, assetKey, content, false);
            } else {
              const arrayBuffer = await file.arrayBuffer();
              const base64 = Buffer.from(arrayBuffer).toString("base64");
              await uploadThemeAsset(shopDomain, accessToken, theme.id, assetKey, base64, true);
            }
            uploaded++;
            send({ type: "progress", uploaded, total, skipped, file: assetKey });
          } catch (err) {
            if (/Shopify denied theme file access|exemption|access denied|write_themes/i.test(err.message)) {
              send({ type: "error", message: err.message });
              return;
            }

            skipped++;
            send({ type: "skip", uploaded, total, skipped, file: assetKey, error: err.message });
          }
        }

        send({
          type: "done",
          uploaded,
          skipped,
          total,
          themeName: theme.name,
          themeId: theme.id,
          message: `Theme "${theme.name}" created with ${uploaded} files (${skipped} skipped)`,
        });
      } catch (err) {
        send({ type: "error", message: err.message });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
