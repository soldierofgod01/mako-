"use client";
import { SideNav } from "@/components/layout/side-nav";
import { BiasModule } from "@/components/bias/bias-module";
import { ScreenerModule } from "@/components/screener/screener-module";
import { AnalyticsModule } from "@/components/analytics/analytics-module";
import { TrackRecordModule } from "@/components/track/track-record-module";
import { useAppStore } from "@/stores/app-store";

export default function Home() {
  const { activeModule } = useAppStore();

  // No splash / hub - app opens straight into the dashboard (v20).
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <SideNav />
        {/* Content sits on a raised canvas above the sidebar — the main depth cue. */}
        <main className="flex-1 flex flex-col overflow-hidden my-2 mr-2 ds-canvas">
          {activeModule === "screener" && <ScreenerModule />}
          {activeModule === "terminal" && <BiasModule />}
          {activeModule === "analytics" && <AnalyticsModule />}
          {activeModule === "track" && <TrackRecordModule />}
        </main>
      </div>
    </div>
  );
}
