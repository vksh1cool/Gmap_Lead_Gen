"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, Target, Users, Settings, Activity } from "lucide-react";
import { motion } from "framer-motion";

export default function Sidebar() {
  const pathname = usePathname();
  const [leadCount, setLeadCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchLeadCount = async () => {
      try {
        const res = await fetch("/api/leads");
        if (res.ok) {
          const data = await res.json();
          setLeadCount(Array.isArray(data) ? data.length : (data.count ?? 0));
        }
      } catch {
        // Silently fail – badge just won't show
      }
    };
    fetchLeadCount();
    // Refresh count every 30 seconds
    const interval = setInterval(fetchLeadCount, 30_000);
    return () => clearInterval(interval);
  }, []);

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/scraper", label: "Lead Hunter", icon: Target },
    { href: "/crm", label: "CRM Pipeline", icon: Users },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside className="w-64 border-r border-border/40 bg-background/80 backdrop-blur-xl flex flex-col h-screen fixed top-0 left-0 z-50">
      {/* Animated gradient line at top */}
      <div className="h-[2px] w-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-blue-500 sidebar-gradient-line" />

      <div className="p-6">
        <h1 className="text-2xl font-black bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent drop-shadow-sm flex items-center gap-2">
          <Target className="text-emerald-400" size={24} />
          LaunchPixel- LeadGen
        </h1>
      </div>
      <nav className="flex-1 px-4 space-y-1.5 mt-2">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;
          const isCRM = link.href === "/crm";
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all relative overflow-hidden ${
                isActive
                  ? "text-white font-medium"
                  : "text-muted-foreground hover:text-white"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="active-tab"
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background:
                      "linear-gradient(90deg, rgba(16,185,129,0.18) 0%, rgba(255,255,255,0.06) 100%)",
                    borderLeft: "2px solid rgba(16,185,129,0.9)",
                    boxShadow:
                      "-2px 0 12px rgba(16,185,129,0.25), inset 0 0 12px rgba(16,185,129,0.06)",
                  }}
                  initial={false}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <div
                className={`relative z-10 p-1.5 rounded-lg transition-colors ${
                  isActive
                    ? "bg-white/20"
                    : "bg-transparent group-hover:bg-white/5"
                }`}
              >
                <Icon
                  size={18}
                  className={
                    isActive
                      ? "text-emerald-400"
                      : "opacity-70 group-hover:opacity-100"
                  }
                />
              </div>
              <span className="relative z-10 flex items-center gap-2">
                {link.label}
                {isCRM && leadCount !== null && leadCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 tabular-nums">
                    {leadCount > 99 ? "99+" : leadCount}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Local Engine Status */}
      <div className="p-5 border-t border-border/40 bg-white/[0.03]">
        <motion.div
          className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-emerald-500/10"
          animate={{
            boxShadow: [
              "0 0 0px rgba(16,185,129,0)",
              "0 0 15px rgba(16,185,129,0.08)",
              "0 0 0px rgba(16,185,129,0)",
            ],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </div>
            <div>
              <p className="text-xs font-medium text-white/90">Local Engine</p>
              <p className="text-[10px] text-emerald-400/80 font-mono tracking-wider">
                ONLINE
              </p>
            </div>
          </div>
          <Activity size={16} className="text-emerald-500/50" />
        </motion.div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 pt-1">
        <p className="text-[10px] text-white/20 font-mono tracking-widest text-center">
          v1.0 · LaunchPixel- LeadGen
        </p>
      </div>
    </aside>
  );
}
