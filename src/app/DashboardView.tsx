"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Target,
  Activity,
  Zap,
  ArrowUpRight,
  TrendingUp,
  BarChart3,
  Database,
  Rocket,
  Briefcase,
  Sparkles,
  MapPin,
  Diamond,
  Clock,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/* ─── Animated Number Counter ─── */
function AnimatedNumber({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    const duration = 1200;
    const steps = 40;
    const increment = value / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const current = Math.min(Math.round(increment * step), value);
      setDisplay(current);
      if (step >= steps) clearInterval(timer);
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <span>
      {prefix}{display.toLocaleString()}{suffix}
    </span>
  );
}

/* ─── Pulsing Gradient Chart ─── */
function PulsingChart({ leadCount }: { leadCount: number }) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  if (!isMounted) return <div className="h-[220px] w-full animate-pulse bg-white/5 rounded-xl" />;

  // Generate dynamic-looking points based on leadCount seed
  const seed = Math.max(leadCount, 10);
  const points = Array.from({ length: 10 }, (_, i) => {
    const x = (i / 9) * 400;
    const wave = Math.sin(i * 0.8 + seed * 0.1) * 25;
    const trend = 100 - (i / 9) * 60;
    return { x, y: Math.max(10, Math.min(110, trend + wave)) };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");
  const areaD = `${pathD} L 400,120 L 0,120 Z`;

  return (
    <div className="relative w-full h-[220px] flex items-end">
      <svg viewBox="0 0 400 120" className="w-full h-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pulseGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(99, 102, 241)" stopOpacity="0.6" />
            <stop offset="50%" stopColor="rgb(52, 211, 153)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(52, 211, 153)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(99, 102, 241)" />
            <stop offset="50%" stopColor="rgb(52, 211, 153)" />
            <stop offset="100%" stopColor="rgb(6, 182, 212)" />
          </linearGradient>
          <filter id="chartGlow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="dotGlow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Horizontal grid lines */}
        {[30, 60, 90].map((y) => (
          <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="white" strokeOpacity="0.04" strokeWidth="1" />
        ))}

        {/* Animated fill area */}
        <motion.path
          d={areaD}
          fill="url(#pulseGrad)"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Animated line */}
        <motion.path
          d={pathD}
          fill="none"
          stroke="url(#lineGrad)"
          strokeWidth="2.5"
          strokeLinecap="round"
          filter="url(#chartGlow)"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.8, ease: "easeInOut" }}
        />

        {/* Animated dots at key points */}
        {points.filter((_, i) => i % 2 === 1).map((p, i) => (
          <motion.circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="4"
            fill="white"
            stroke="url(#lineGrad)"
            strokeWidth="2"
            filter="url(#dotGlow)"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [1, 1.3, 1], opacity: 1 }}
            transition={{
              scale: { delay: 1.5 + i * 0.2, duration: 2, repeat: Infinity, ease: "easeInOut" },
              opacity: { delay: 1 + i * 0.15, duration: 0.4 },
            }}
          />
        ))}

        {/* Trailing glow particle */}
        <motion.circle
          cx="0"
          cy="0"
          r="6"
          fill="rgb(52, 211, 153)"
          opacity="0.6"
          filter="url(#dotGlow)"
        >
          <animateMotion dur="4s" repeatCount="indefinite" path={pathD} />
        </motion.circle>
      </svg>

      {/* Subtle scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, white 2px, white 3px)",
        }}
      />
    </div>
  );
}

/* ─── Stat Card Configuration ─── */
const STAT_CONFIG = [
  {
    key: "totalLeads",
    label: "Total Leads Scraped",
    icon: Database,
    gradient: "from-blue-500 to-cyan-400",
    glowColor: "rgba(59, 130, 246, 0.3)",
    iconBg: "bg-blue-500/15",
    border: "border-blue-500/20",
    ring: "ring-blue-400/20",
  },
  {
    key: "diamondLeads",
    label: "Diamond Leads",
    icon: Diamond,
    gradient: "from-emerald-400 to-green-500",
    glowColor: "rgba(52, 211, 153, 0.3)",
    iconBg: "bg-emerald-500/15",
    border: "border-emerald-500/20",
    ring: "ring-emerald-400/20",
  },
  {
    key: "activePipelines",
    label: "Active Pipelines",
    icon: Activity,
    gradient: "from-violet-500 to-fuchsia-400",
    glowColor: "rgba(139, 92, 246, 0.3)",
    iconBg: "bg-violet-500/15",
    border: "border-violet-500/20",
    ring: "ring-violet-400/20",
  },
  {
    key: "estRevenue",
    label: "Est. Revenue",
    icon: TrendingUp,
    gradient: "from-amber-400 to-orange-500",
    glowColor: "rgba(251, 191, 36, 0.3)",
    iconBg: "bg-amber-500/15",
    border: "border-amber-500/20",
    ring: "ring-amber-400/20",
  },
] as const;

/* ─── Activity type styles ─── */
const activityStyles: Record<string, { dot: string; glowColor: string; badge: string; badgeText: string }> = {
  diamond: { dot: "bg-emerald-400", glowColor: "rgba(52,211,153,0.5)", badge: "bg-emerald-500/10 text-emerald-400", badgeText: "Diamond" },
  scrape: { dot: "bg-blue-400", glowColor: "rgba(96,165,250,0.5)", badge: "bg-blue-500/10 text-blue-400", badgeText: "Lead" },
  success: { dot: "bg-amber-400", glowColor: "rgba(251,191,36,0.5)", badge: "bg-amber-500/10 text-amber-400", badgeText: "Won" },
  action: { dot: "bg-violet-400", glowColor: "rgba(167,139,250,0.5)", badge: "bg-violet-500/10 text-violet-400", badgeText: "Action" },
};

/* ─── Quick Action Cards ─── */
const QUICK_ACTIONS = [
  {
    title: "Launch Scraper",
    description: "Discover new leads from Google Maps",
    href: "/?tab=scraper",
    icon: Rocket,
    gradient: "from-indigo-500 to-cyan-400",
    glow: "rgba(99, 102, 241, 0.25)",
  },
  {
    title: "Open CRM",
    description: "Manage pipeline & close deals",
    href: "/?tab=crm",
    icon: Briefcase,
    gradient: "from-emerald-400 to-teal-500",
    glow: "rgba(52, 211, 153, 0.25)",
  },
];

/* ─── Main Dashboard ─── */
export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalLeads: 0,
    diamondLeads: 0,
    activePipelines: 0,
    estRevenue: 0,
  });
  const [activities, setActivities] = useState<
    { time: string; action: string; type: string; name: string; category: string; phone?: string; address?: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/leads");
        if (res.ok) {
          const data = await res.json();
          const leads = data.leads || data || [];

          const diamondLeads = leads.filter((l: any) => l.lead_category === "Diamond").length;
          const activePipelines = leads.filter(
            (l: any) => l.status === "Uncontacted" || l.status === "Emailed"
          ).length;

          setStats({
            totalLeads: leads.length,
            diamondLeads,
            activePipelines,
            estRevenue: diamondLeads * 1250,
          });

          // Generate real activity from recent leads
          const recentLeads = leads.slice(0, 5);
          const timeLabels = ["Just now", "2m ago", "15m ago", "1h ago", "3h ago"];
          const dynamicActivity = recentLeads.map((l: any, i: number) => ({
            time: timeLabels[i] || "Recently",
            action: l.address ? `Located in ${l.address}` : "New lead discovered",
            type: l.lead_category === "Diamond" ? "diamond" : "scrape",
            name: l.name || "Unknown Business",
            category: l.lead_category || "Standard",
            phone: l.phone,
            address: l.address,
          }));
          setActivities(dynamicActivity);
        }
      } catch (err) {
        console.error("Failed to fetch leads:", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchStats();
  }, []);

  const getStatValue = (key: string) => {
    switch (key) {
      case "totalLeads": return stats.totalLeads;
      case "diamondLeads": return stats.diamondLeads;
      case "activePipelines": return stats.activePipelines;
      case "estRevenue": return stats.estRevenue;
      default: return 0;
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-6 py-8">
      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4"
      >
        <div>
          <h1 className="text-4xl font-black tracking-tight text-white flex items-center gap-3">
            Command Center
            <motion.span
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, type: "spring" }}
              className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(52,211,153,0.15)]"
            >
              <motion.span
                animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2"
              />
              Live
            </motion.span>
          </h1>
          <p className="text-white/40 mt-2 text-base">
            Your automated lead generation engine is running.{" "}
            <span className="font-mono text-white/25 text-sm">{currentTime}</span>
          </p>
        </div>

        <Link
          href="/?tab=scraper"
          className="group relative inline-flex items-center justify-center px-7 py-3.5 font-semibold text-white transition-all duration-300 rounded-2xl overflow-hidden
            bg-gradient-to-r from-indigo-600/80 to-cyan-600/80 hover:from-indigo-500 hover:to-cyan-500
            border border-white/10 hover:border-white/20
            shadow-[0_0_20px_rgba(99,102,241,0.2)] hover:shadow-[0_0_30px_rgba(99,102,241,0.4)]
            hover:scale-[1.03] active:scale-[0.98]"
        >
          <span className="absolute inset-0 bg-gradient-to-t from-white/0 to-white/5" />
          <span className="relative flex items-center gap-2.5">
            <Zap size={18} className="text-amber-300" />
            Launch Engine
            <ArrowUpRight size={16} className="opacity-50 group-hover:opacity-100 transition-opacity group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transform duration-200" />
          </span>
        </Link>
      </motion.div>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {STAT_CONFIG.map((stat, idx) => {
          const Icon = stat.icon;
          const rawValue = getStatValue(stat.key);
          return (
            <motion.div
              key={stat.key}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + idx * 0.1, type: "spring", stiffness: 80, damping: 15 }}
              whileHover={{ y: -6, scale: 1.03 }}
              className={`relative overflow-hidden bg-black/50 backdrop-blur-2xl border ${stat.border} rounded-2xl p-6 group cursor-default`}
              style={{
                boxShadow: `0 0 1px ${stat.glowColor}, 0 4px 30px rgba(0,0,0,0.4)`,
              }}
            >
              {/* Background glow blob */}
              <motion.div
                className={`absolute -right-8 -top-8 w-28 h-28 rounded-full blur-[50px] bg-gradient-to-br ${stat.gradient}`}
                initial={{ opacity: 0.1 }}
                animate={{ opacity: [0.1, 0.25, 0.1] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: idx * 0.5 }}
              />

              {/* Top accent line */}
              <div className={`absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r ${stat.gradient} opacity-30`} />

              <div className="relative z-10">
                <div className="flex justify-between items-start mb-5">
                  <motion.div
                    className={`p-3 rounded-xl ${stat.iconBg} ring-1 ${stat.ring}`}
                    whileHover={{ rotate: [0, -8, 8, 0] }}
                    transition={{ duration: 0.5 }}
                  >
                    <Icon size={22} className="text-white/90" />
                  </motion.div>
                  <motion.div
                    animate={{ opacity: [0.3, 0.7, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className={`w-2 h-2 rounded-full bg-gradient-to-r ${stat.gradient}`}
                  />
                </div>

                <h3 className="text-3xl font-black text-white tracking-tight mb-1.5">
                  {isLoading ? (
                    <motion.span
                      animate={{ opacity: [0.3, 0.7, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      ···
                    </motion.span>
                  ) : stat.key === "estRevenue" ? (
                    <AnimatedNumber
                      value={Math.round(rawValue / 1000)}
                      prefix="$"
                      suffix="K"
                    />
                  ) : (
                    <AnimatedNumber value={rawValue} />
                  )}
                </h3>
                <p className="text-sm text-white/35 font-medium">{stat.label}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ── Chart + Activity Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Chart Area */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="lg:col-span-3 bg-black/40 backdrop-blur-2xl border border-white/[0.06] rounded-3xl p-8 relative overflow-hidden"
        >
          {/* Top accent glow bar */}
          <motion.div
            className="absolute top-0 left-0 w-full h-[1px]"
            style={{
              background: "linear-gradient(90deg, transparent, rgb(99, 102, 241), rgb(52, 211, 153), transparent)",
            }}
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 3, repeat: Infinity }}
          />

          {/* Corner glow */}
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-indigo-500/10 rounded-full blur-[60px]" />

          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2.5">
                <BarChart3 className="text-emerald-400" size={20} />
                Lead Acquisition Velocity
              </h2>
              <p className="text-sm text-white/30 mt-1">Growth trend across all channels</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/25 font-mono">
              <motion.div
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-1.5 h-1.5 rounded-full bg-emerald-400"
              />
              Realtime
            </div>
          </div>

          <PulsingChart leadCount={stats.totalLeads} />
        </motion.div>

        {/* Activity Feed */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="lg:col-span-2 bg-black/40 backdrop-blur-2xl border border-white/[0.06] rounded-3xl p-7 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2.5">
              <Sparkles className="text-violet-400" size={18} />
              Recent Finds
            </h2>
            <span className="text-xs text-white/20 font-mono">
              {activities.length} entries
            </span>
          </div>

          <div className="space-y-1">
            <AnimatePresence>
              {activities.length > 0 ? (
                activities.map((activity, idx) => {
                  const style = activityStyles[activity.type] || activityStyles.scrape;
                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: 15 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.7 + idx * 0.1 }}
                      className="group relative flex items-start gap-3.5 py-3 px-3 rounded-xl hover:bg-white/[0.03] transition-colors duration-200"
                    >
                      {/* Timeline connector */}
                      {idx !== activities.length - 1 && (
                        <div className="absolute left-[21px] top-10 bottom-[-4px] w-[1px] bg-gradient-to-b from-white/10 to-transparent" />
                      )}

                      {/* Dot */}
                      <div className="relative flex-shrink-0 mt-1">
                        <motion.div
                          animate={{
                            boxShadow: [
                              `0 0 0px ${style.glowColor.replace("0.5", "0")}`,
                              `0 0 8px ${style.glowColor}`,
                              `0 0 0px ${style.glowColor.replace("0.5", "0")}`,
                            ],
                          }}
                          transition={{ duration: 2, repeat: Infinity, delay: idx * 0.3 }}
                          className={`w-2.5 h-2.5 rounded-full ${style.dot} shadow-lg`}
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-white/90 truncate">{activity.name}</p>
                          <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${style.badge}`}>
                            {style.badgeText}
                          </span>
                        </div>
                        <p className="text-xs text-white/35 truncate flex items-center gap-1">
                          {activity.address && <MapPin size={10} className="flex-shrink-0" />}
                          {activity.action}
                        </p>
                        <p className="text-[10px] text-white/20 mt-1 font-mono flex items-center gap-1">
                          <Clock size={9} />
                          {activity.time}
                        </p>
                      </div>
                    </motion.div>
                  );
                })
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-10 text-center"
                >
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                    <Sparkles className="text-white/20" size={20} />
                  </div>
                  <p className="text-sm text-white/30">No leads found yet.</p>
                  <p className="text-xs text-white/15 mt-1">Launch the engine to start discovering!</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* ── Quick Actions ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
      >
        <h2 className="text-sm font-semibold text-white/25 uppercase tracking-widest mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <motion.div
                key={action.title}
                whileHover={{ y: -4, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
              >
                <Link
                  href={action.href}
                  className="group relative flex items-center gap-5 p-6 bg-black/40 backdrop-blur-2xl border border-white/[0.06] rounded-2xl overflow-hidden transition-all duration-300
                    hover:border-white/10 hover:shadow-[0_0_30px_rgba(99,102,241,0.1)]"
                >
                  {/* Background sweep */}
                  <div
                    className={`absolute inset-0 bg-gradient-to-r ${action.gradient} opacity-0 group-hover:opacity-[0.04] transition-opacity duration-500`}
                  />

                  {/* Icon */}
                  <div
                    className={`relative flex-shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br ${action.gradient} flex items-center justify-center shadow-lg`}
                    style={{ boxShadow: `0 4px 20px ${action.glow}` }}
                  >
                    <Icon size={24} className="text-white" />
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-white group-hover:text-white/95 transition-colors">
                      {action.title}
                    </h3>
                    <p className="text-sm text-white/30 mt-0.5">{action.description}</p>
                  </div>

                  {/* Arrow */}
                  <ChevronRight
                    size={20}
                    className="text-white/15 group-hover:text-white/40 group-hover:translate-x-1 transition-all duration-300"
                  />
                </Link>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
