import {
  getSessionForShop,
  listThemes,
  downloadThemeAsZip,
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
