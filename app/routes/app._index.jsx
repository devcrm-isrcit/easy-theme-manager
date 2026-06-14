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
