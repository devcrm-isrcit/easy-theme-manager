import {
  getSessionForShop,
  listThemes,
  iterateThemeFiles,
} from "../services/theme.server";

const CHUNK_SIZE = 512 * 1024;

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

        send({ type: "status", message: `Fetching files for "${themeName}"...` });

        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();

        let fetched = 0;
        let skipped = 0;

        for await (const asset of iterateThemeFiles(shopDomain, accessToken, themeId)) {
          try {
            if (asset.attachment != null) {
              zip.file(asset.key, asset.attachment, { base64: true });
            } else if (asset.value != null) {
              zip.file(asset.key, asset.value);
            }
            fetched++;
            if (fetched === 1 || fetched % 25 === 0) {
              send({ type: "progress", fetched, total: fetched, skipped, file: asset.key });
            }
          } catch (err) {
            skipped++;
            send({ type: "skip", fetched, total: fetched, skipped, file: asset.key, error: err.message });
          }
        }

        send({ type: "progress", fetched, total: fetched, skipped, file: "all files fetched" });
        send({ type: "init", total: fetched, message: `Found ${fetched} assets, generating zip...` });

        const base64 = await zip.generateAsync({ type: "base64" });

        const totalChunks = Math.ceil(base64.length / CHUNK_SIZE);
        for (let i = 0; i < totalChunks; i++) {
          const chunk = base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          send({ type: "chunk", index: i, total: totalChunks, data: chunk });
        }

        const safeName = themeName.replace(/[^a-zA-Z0-9_-]/g, "_");
        send({
          type: "done",
          fetched,
          skipped,
          total: fetched,
          filename: `${safeName}.zip`,
          chunks: totalChunks,
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
