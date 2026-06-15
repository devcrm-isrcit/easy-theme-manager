import {
  getSessionForShop,
  listThemes,
  getThemeFileNames,
  getThemeFileContent,
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
        const safeName = themeName.replace(/[^a-zA-Z0-9_-]/g, "_");

        send({ type: "status", message: `Fetching file list for "${themeName}"...` });

        const filenames = await getThemeFileNames(shopDomain, accessToken, themeId);
        const total = filenames.length;

        send({ type: "init", total, message: `Found ${total} files` });

        let fetched = 0;
        let skipped = 0;

        for (const filename of filenames) {
          try {
            const asset = await getThemeFileContent(shopDomain, accessToken, themeId, filename);

            if (asset.attachment != null) {
              send({ type: "file", key: asset.key, attachment: asset.attachment });
            } else if (asset.value != null) {
              send({ type: "file", key: asset.key, value: asset.value });
            }
            fetched++;
            send({ type: "progress", fetched, total, file: filename });
          } catch (err) {
            skipped++;
            send({ type: "skip", file: filename, error: err.message });
          }
        }

        send({
          type: "done",
          fetched,
          skipped,
          total,
          filename: `${safeName}.zip`,
          message: `Downloaded ${fetched} files (${skipped} skipped)`,
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
