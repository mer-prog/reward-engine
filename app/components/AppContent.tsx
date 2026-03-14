import { Link, Outlet } from "@remix-run/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { useTranslation } from "../i18n/i18nContext";
import { LanguageToggle } from "./LanguageToggle";

export function AppContent() {
  const { t } = useTranslation();

  return (
    <>
      <NavMenu>
        <Link to="/app" rel="home">
          {t("nav.dashboard")}
        </Link>
        <Link to="/app/rules/new">{t("nav.newRule")}</Link>
        <Link to="/app/activity">{t("nav.activityLog")}</Link>
        <Link to="/app/queue">{t("nav.queueMonitor")}</Link>
      </NavMenu>
      <div style={{ position: "fixed", top: 8, right: 16, zIndex: 1000 }}>
        <LanguageToggle />
      </div>
      <Outlet />
    </>
  );
}
