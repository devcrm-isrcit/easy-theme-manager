import {
  getSessionForShop,
  listThemes,
  getThemeFiles,
} from "../services/theme.server";

export const loader = async ({ request, params }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const secret = process.env.ADMIN_SECRET_KEY;

  if (!secret || key !== secret) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const shopDomain = decodeURIComponent(params.shopId);
  const themeId = params.id;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const { accessToken } = await getSessionForShop(shopDomain);
        const themes = await listThemes(shopDomain, accessToken);
        const theme = themes.find((t) => String(t.id) === String(themeId));
        const themeName = theme?.name || `theme-${themeId}`;

        send({ type: "status", message: `Fetching asset list for "${themeName}"...` });

        const assets = await getThemeFiles(shopDomain, accessToken, themeId);
        const total = assets.length;
        send({ type: "init", total, message: `Found ${total} assets to download` });

        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();

        let fetched = 0;
        let skipped = 0;

        for (const asset of assets) {
          try {
            if (asset.attachment != null) {
              zip.file(asset.key, asset.attachment, { base64: true });
            } else if (asset.value != null) {
              zip.file(asset.key, asset.value);
            }
            fetched++;
            send({ type: "progress", fetched, total, skipped, file: asset.key });
          } catch (err) {
            skipped++;
            send({ type: "skip", fetched, total, skipped, file: asset.key, error: err.message });
          }
        }

        send({ type: "status", message: "Generating zip file..." });

        const buffer = await zip.generateAsync({ type: "base64" });
        const safeName = themeName.replace(/[^a-zA-Z0-9_-]/g, "_");

        send({
          type: "done",
          fetched,
          skipped,
          total,
          filename: `${safeName}.zip`,
          zipBase64: buffer,
          message: `Downloaded ${fetched} assets (${skipped} skipped)`,
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
