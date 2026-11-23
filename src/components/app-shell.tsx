"use client";
import { useEffect } from "react";
import { SideNav } from "@/components/layout/side-nav";
import { BiasModule } from "@/components/bias/bias-module";
import { ScreenerModule } from "@/components/screener/screener-module";
import { AnalyticsModule } from "@/components/analytics/analytics-module";
import { TrackRecordModule } from "@/components/track/track-record-module";
import { useAppStore } from "@/stores/app-store";

export function AppShell() {
  const { activeModule, setActiveModule } = useAppStore();

  // Hidden route: the track record isn't in the rail yet — open it with /?track.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("track")) setActiveModule("track");
  }, [setActiveModule]);

  // No splash / hub - app opens straight into the dashboard (v20).
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <SideNav />
        {/* Floating panels: modules lay themselves out as rounded cards with
            8px gaps; the darker void shows between them. */}
        <main className="flex-1 flex flex-col overflow-hidden py-2 pr-2">
          {activeModule === "screener" && <ScreenerModule />}
          {activeModule === "terminal" && <BiasModule />}
          {activeModule === "analytics" && <div className="flex-1 flex flex-col overflow-hidden ds-card-panel"><AnalyticsModule /></div>}
          {activeModule === "track" && <div className="flex-1 flex flex-col overflow-hidden ds-card-panel"><TrackRecordModule /></div>}
        </main>
      </div>
    </div>
  );
}
