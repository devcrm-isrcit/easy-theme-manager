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
