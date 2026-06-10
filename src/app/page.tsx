"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import DashboardView from "./DashboardView";
import ScraperView from "./scraper/ScraperView";
import CRMView from "./crm/CRMView";
import SettingsView from "./settings/SettingsView";

function AppContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "dashboard";

  return (
    <>
      <div className={tab === "dashboard" ? "block h-full" : "hidden h-full"}>
        <DashboardView />
      </div>
      <div className={tab === "scraper" ? "block h-full" : "hidden h-full"}>
        <ScraperView />
      </div>
      <div className={tab === "crm" ? "block h-full" : "hidden h-full"}>
        <CRMView />
      </div>
      <div className={tab === "settings" ? "block h-full" : "hidden h-full"}>
        <SettingsView />
      </div>
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full text-white/50">Loading application...</div>}>
      <AppContent />
    </Suspense>
  );
}
