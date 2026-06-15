import { Outlet, useLoaderData } from "react-router";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const secret = process.env.ADMIN_SECRET_KEY;

  if (!secret || key !== secret) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return { key };
};

export default function AdminLayout() {
  const { key } = useLoaderData();

  return (
    <>
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: `window.tailwind = window.tailwind || {}; tailwind.config = {
            theme: {
              extend: {
                colors: {
                  slate: { 850: '#172033' }
                }
              }
            }
          }`,
        }}
      />
      <script suppressHydrationWarning src="https://cdn.tailwindcss.com" />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            body { background: #020617; color: #e2e8f0; margin: 0; min-height: 100vh; font-family: system-ui, -apple-system, sans-serif; }
            .tw-nav { background: #1e293b; border-bottom: 1px solid #334155; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
            .tw-nav-title { font-size: 18px; font-weight: 700; color: #fff; }
            .tw-nav-badge { font-size: 12px; color: #64748b; margin-left: 8px; }
            .tw-nav-status { font-size: 12px; color: #64748b; }
            .tw-main { max-width: 64rem; margin: 0 auto; padding: 32px 24px; }
          `,
        }}
      />
      <div style={{ minHeight: "100vh", background: "#020617", color: "#e2e8f0" }}>
        <nav className="tw-nav">
          <div style={{ display: "flex", alignItems: "center" }}>
            <span className="tw-nav-title">Theme Operator</span>
            <span className="tw-nav-badge">Admin</span>
          </div>
          <div className="tw-nav-status">Logged in as Admin</div>
        </nav>
        <main className="tw-main">
          <Outlet context={{ key }} />
        </main>
      </div>
    </>
  );
}
