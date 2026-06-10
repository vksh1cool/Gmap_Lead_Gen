"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Target, Download, Loader2, Mail, ExternalLink, Star, ShieldAlert, Key, Gem, Trophy, Trash2, Clock, Radio, CheckCircle2, Zap, User, Sparkles, CheckSquare, Square, Activity, MapPin, Navigation } from 'lucide-react';
import { ScoredLead } from '@/lib/types';

/* ── Animation variants ── */
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  exit: {
    opacity: 0,
    y: -20,
    scale: 0.95,
    transition: { duration: 0.3 },
  },
};

/* ── Stage definitions ── */
type Stage = 'idle' | 'connecting' | 'scraping' | 'analyzing' | 'saving' | 'complete' | 'error';

const PIPELINE_STAGES: { key: Stage; label: string; icon: React.ReactNode }[] = [
  { key: 'connecting', label: 'Connecting', icon: <Radio className="w-4 h-4" /> },
  { key: 'scraping', label: 'Scraping', icon: <Search className="w-4 h-4" /> },
  { key: 'analyzing', label: 'AI Analysis', icon: <Zap className="w-4 h-4" /> },
  { key: 'saving', label: 'Saving', icon: <Download className="w-4 h-4" /> },
  { key: 'complete', label: 'Complete', icon: <CheckCircle2 className="w-4 h-4" /> },
];

function getStageIndex(stage: Stage): number {
  const idx = PIPELINE_STAGES.findIndex((s) => s.key === stage);
  return idx === -1 ? -1 : idx;
}

/* ── Platform definitions ── */
interface PlatformDef {
  id: string;
  label: string;
  emoji: string;
  color: string;
  glowColor: string;
}

const PLATFORMS: PlatformDef[] = [
  { id: 'gmaps', label: 'Google Maps', emoji: '📍', color: 'border-emerald-400 bg-emerald-500/15 text-emerald-300', glowColor: 'shadow-emerald-500/25' },
  { id: 'reddit', label: 'Reddit', emoji: '🔶', color: 'border-orange-400 bg-orange-500/15 text-orange-300', glowColor: 'shadow-orange-500/25' },
  { id: 'x', label: 'X / Twitter', emoji: '✕', color: 'border-gray-300 bg-white/10 text-gray-200', glowColor: 'shadow-white/15' },
  { id: 'linkedin', label: 'LinkedIn', emoji: '🔗', color: 'border-blue-400 bg-blue-500/15 text-blue-300', glowColor: 'shadow-blue-500/25' },
  { id: 'instagram', label: 'Instagram', emoji: '📸', color: 'border-pink-400 bg-pink-500/15 text-pink-300', glowColor: 'shadow-pink-500/25' },
  { id: 'hackernews', label: 'HackerNews', emoji: '🟧', color: 'border-orange-500 bg-orange-600/15 text-orange-400', glowColor: 'shadow-orange-600/25' },
  { id: 'devto', label: 'Dev.to', emoji: '⚡', color: 'border-indigo-400 bg-indigo-500/15 text-indigo-300', glowColor: 'shadow-indigo-500/25' },
  { id: 'darkweb', label: 'Dark Web / Tor', emoji: '🧅', color: 'border-purple-600 bg-purple-700/15 text-purple-400', glowColor: 'shadow-purple-700/25' },
  { id: 'stackoverflow', label: 'StackOverflow', emoji: '📚', color: 'border-orange-400 bg-orange-500/15 text-orange-300', glowColor: 'shadow-orange-500/25' },
  { id: 'quora', label: 'Quora', emoji: '💬', color: 'border-red-400 bg-red-500/15 text-red-300', glowColor: 'shadow-red-500/25' },
  { id: 'producthunt', label: 'ProductHunt', emoji: '🚀', color: 'border-orange-400 bg-orange-500/15 text-orange-300', glowColor: 'shadow-orange-500/25' },
  { id: 'upwork', label: 'Upwork', emoji: '💼', color: 'border-green-400 bg-green-500/15 text-green-300', glowColor: 'shadow-green-500/25' },
];

function getPlatformBadge(platformId: string) {
  const p = PLATFORMS.find(pl => pl.id === platformId);
  if (!p) return { emoji: '🌐', label: platformId, colorClass: 'bg-gray-500/20 text-gray-300 border-gray-500/30' };
  return { emoji: p.emoji, label: p.label, colorClass: `${p.color}` };
}

function useElapsedTimer(isRunning: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      startRef.current = Date.now();
      setElapsed(0);
      const tick = () => {
        if (startRef.current) {
          setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isRunning]);
  return elapsed;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function Home() {
  // ── Smart Intent State ──
  const [intentDump, setIntentDump] = useState('');
  const [isAnalyzingIntent, setIsAnalyzingIntent] = useState(false);
  const [generatedOptions, setGeneratedOptions] = useState<any[]>([]);
  const [selectedOptionIndices, setSelectedOptionIndices] = useState<number[]>([]);
  const [limit, setLimit] = useState<number>(10);

  // ── Multi-platform state ──
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(PLATFORMS.map(p => p.id));

  const togglePlatform = (id: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelectedPlatforms(PLATFORMS.map(p => p.id));
  const selectSocialOnly = () => setSelectedPlatforms(PLATFORMS.filter(p => p.id !== 'gmaps').map(p => p.id));

  const [niche, setNiche] = useState('');
  const [location, setLocation] = useState('');

  const [isScraping, setIsScraping] = useState(false);
  const [leads, setLeads] = useState<ScoredLead[]>([]);
  const [progress, setProgress] = useState<string>('');
  
  const [apiKey, setApiKey] = useState('');
  const [aiProvider, setAiProvider] = useState('nim');
  const [aiModel, setAiModel] = useState('meta/llama-3.1-8b-instruct');

  const [stage, setStage] = useState<Stage>('idle');
  const [currentLeadName, setCurrentLeadName] = useState<string>('');
  
  type RateLimitNotice = { platform: string; label: string; cooldown_minutes: number; message: string; until: number };
  const [rateLimits, setRateLimits] = useState<Record<string, RateLimitNotice>>({});
  const dismissRateLimit = (platform: string) =>
    setRateLimits(prev => { const next = { ...prev }; delete next[platform]; return next; });

  const elapsed = useElapsedTimer(isScraping);

  useEffect(() => {
    const provider = localStorage.getItem('ai_provider') || 'nim';
    setAiProvider(provider);
    
    let key = '';
    let model = '';
    if (provider === 'nim') {
      key = localStorage.getItem('nim_api_key') || '';
      model = localStorage.getItem('nim_model') || 'meta/llama-3.1-8b-instruct';
    } else if (provider === 'openai') {
      key = localStorage.getItem('openai_api_key') || '';
      model = localStorage.getItem('openai_model') || 'gpt-4o-mini';
    } else if (provider === 'gemini') {
      key = localStorage.getItem('gemini_api_key') || '';
      model = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
    }
    
    setApiKey(key);
    setAiModel(model);
  }, []);

  const deriveStage = useCallback((type: string, message?: string): void => {
    if (type === 'info') {
      const msg = (message || '').toLowerCase();
      if (msg.includes('initializ') || msg.includes('connect') || msg.includes('launching') || msg.includes('starting')) {
        setStage('connecting');
      } else if (msg.includes('scraping') || msg.includes('scrolling') || msg.includes('found')) {
        setStage('scraping');
      } else if (msg.includes('saving') || msg.includes('stored') || msg.includes('database')) {
        setStage('saving');
      }
    } else if (type === 'raw') {
      setStage('scraping');
    } else if (type === 'scored') {
      setStage('analyzing');
    } else if (type === 'done') {
      setStage('complete');
    } else if (type === 'error') {
      setStage('error');
    }
  }, []);

  const readStream = async (res: Response) => {
    if (!res.body) throw new Error('No readable stream');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          deriveStage(parsed.type, parsed.message);

          if (parsed.type === 'info') {
            setProgress(parsed.message);
          } else if (parsed.type === 'raw') {
            setProgress(`Found ${parsed.data.name}, analyzing with AI...`);
            setCurrentLeadName(parsed.data.name);
            setLeads((prev) => {
              const exists = prev.find(l => l.id === parsed.data.id);
              if (exists) return prev;
              return [...prev, { ...parsed.data, lead_score: 0, rationale: 'Analyzing...', suggested_pitch: '' }];
            });
          } else if (parsed.type === 'scored') {
            setProgress(`AI Analyzed: ${parsed.data.name}`);
            setCurrentLeadName(parsed.data.name);
            setLeads((prev) => prev.map(l => l.id === parsed.data.id ? parsed.data : l));
          } else if (parsed.type === 'done') {
            setProgress('Scraping complete!');
          } else if (parsed.type === 'rate_limited') {
            setRateLimits((prev) => ({
              ...prev,
              [parsed.platform]: {
                platform: parsed.platform,
                label: parsed.label || parsed.platform,
                cooldown_minutes: parsed.cooldown_minutes || 15,
                message: parsed.message || '',
                until: Date.now() + (parsed.cooldown_seconds || 900) * 1000,
              },
            }));
            setProgress(`${parsed.label || parsed.platform} rate-limited — paused ~${parsed.cooldown_minutes || 15} min`);
          } else if (parsed.type === 'error') {
            setProgress(`Error: ${parsed.message}`);
          }
        } catch (err) {
          console.error('Error parsing NDJSON line:', line, err);
        }
      }
    }
  };

  const handleAnalyzeIntent = async () => {
    if (!intentDump.trim()) return;
    setIsAnalyzingIntent(true);
    setGeneratedOptions([]);
    setSelectedOptionIndices([]);
    try {
      const res = await fetch('/api/analyze-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: intentDump, platforms: selectedPlatforms, niche, location, apiKey, aiProvider, aiModel }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setGeneratedOptions(data.options || []);
      // Auto-select all generated options
      setSelectedOptionIndices((data.options || []).map((_: any, i: number) => i));
    } catch (err: any) {
      console.error(err);
      alert('Failed to analyze intent: ' + err.message);
    } finally {
      setIsAnalyzingIntent(false);
    }
  };

  const toggleOption = (idx: number) => {
    setSelectedOptionIndices(prev => 
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedOptionIndices.length === 0) return;

    setIsScraping(true);
    setLeads([]);
    setProgress('Initializing engine...');
    setStage('connecting');
    setCurrentLeadName('');

    try {
      const requests = selectedOptionIndices.map(idx => {
        const option = generatedOptions[idx];
        const payload = {
          platform: option.platform,
          niche: option.niche || niche,
          location: option.location || location,
          keyword: option.keyword,
          limit,
          apiKey,
          aiProvider,
          aiModel,
        };
        return fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(res => readStream(res));
      });

      await Promise.all(requests);
      setStage('complete');
      setProgress('Scraping complete!');
      setIsScraping(false);
      setCurrentLeadName('');
    } catch (error: any) {
      console.error(error);
      setProgress(`Failed: ${error.message}`);
      setStage('error');
      setIsScraping(false);
      setCurrentLeadName('');
    }
  };

  const exportCSV = () => {
    if (leads.length === 0) return;
    try {
      const csvData = leads.map(l => ({
        Name: l.name,
        Platform: l.platform || 'gmaps',
        Score: l.lead_score,
        Category: l.lead_category || '',
        Business_Category: l.category || '',
        Rating: l.rating || '',
        Reviews: l.reviews || '',
        Phone: l.phone || '',
        Website: l.website || '',
        Emails: l.emails_found?.join(', ') || '',
        Author: l.author || '',
        Post_URL: l.post_url || '',
        Title: l.title || '',
        Pitch: l.suggested_pitch || '',
        Rationale: l.rationale || '',
      }));
      
      const headers = Object.keys(csvData[0]);
      const csvRows = [];
      csvRows.push(headers.join(','));
      
      for (const row of csvData) {
        const values = headers.map(header => {
          const val = (row as any)[header] ?? '';
          const escaped = val.toString().replace(/"/g, '""');
          return `"${escaped}"`;
        });
        csvRows.push(values.join(','));
      }
      
      const csv = csvRows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads-smart-intent-${Date.now()}.csv`.replace(/\s+/g, '_');
      a.click();
    } catch (err) {
      console.error(err);
      alert('Failed to export CSV');
    }
  };

  const currentStageIdx = getStageIndex(stage);
  // Progress percent calculation is rough since we have multiple options
  const totalLimit = limit * selectedOptionIndices.length;
  const progressPercent = leads.length > 0 && totalLimit > 0 ? Math.min((leads.length / totalLimit) * 100, 100) : 0;

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-white p-8 font-sans selection:bg-indigo-500/30">
      <AnimatePresence>
        {Object.keys(rateLimits).length > 0 && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setRateLimits({})}
          >
            <motion.div
              className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#141414] p-6 shadow-2xl shadow-amber-500/10"
              initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15">
                  <ShieldAlert className="h-6 w-6 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Rate limit reached</h3>
                  <p className="text-xs text-gray-400">Pausing affected platforms to protect your IP</p>
                </div>
              </div>
              <div className="space-y-3">
                {Object.values(rateLimits).map((rl) => (
                  <div key={rl.platform} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-2 text-sm font-medium text-amber-300">
                        <Clock className="h-4 w-4" /> {rl.label}
                      </span>
                      <span className="text-xs text-gray-500">~{rl.cooldown_minutes} min cooldown</span>
                    </div>
                    <p className="text-xs leading-relaxed text-gray-400">{rl.message}</p>
                    <button onClick={() => dismissRateLimit(rl.platform)}
                      className="mt-2 text-xs font-medium text-indigo-400 hover:text-indigo-300">
                      Dismiss
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={() => setRateLimits({})}
                className="mt-5 w-full rounded-xl bg-white/10 py-2.5 text-sm font-medium text-white hover:bg-white/15 transition">
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="max-w-7xl mx-auto space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.header
          variants={itemVariants}
          className="flex flex-col md:flex-row items-center justify-between gap-6 pb-8 border-b border-white/10"
        >
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              LaunchPixel Smart Engine
            </h1>
            <p className="text-gray-400 text-sm">Tell the AI what you want, and it will generate specific lead targets for you.</p>
          </div>
          <AnimatePresence>
            {leads.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex items-center gap-3"
              >
                <button
                  id="btn-export-csv"
                  onClick={exportCSV}
                  className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-full transition-all text-sm font-medium backdrop-blur-sm"
                >
                  <Download className="w-4 h-4" /> Export CSV ({leads.length})
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.header>

        {/* Form Container */}
        <motion.section
          variants={itemVariants}
          className="animated-gradient-border bg-white/[0.03] p-6 rounded-2xl backdrop-blur-xl shadow-2xl space-y-6 relative"
        >
          <div className="absolute -top-32 -right-32 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Platform Selectors */}
          <div className="space-y-4 relative z-10 border-b border-white/10 pb-6">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                <Target className="w-4 h-4" /> Targeted Platforms
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={selectAll} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 transition-colors border border-white/10">All</button>
                <button type="button" onClick={() => setSelectedPlatforms([])} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 transition-colors border border-white/10">None</button>
                <button type="button" onClick={selectSocialOnly} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 transition-colors border border-indigo-500/20">Social Only</button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {PLATFORMS.map(platform => {
                const isSelected = selectedPlatforms.includes(platform.id);
                return (
                  <button
                    key={platform.id}
                    type="button"
                    onClick={() => togglePlatform(platform.id)}
                    className={`
                      relative overflow-hidden p-3 rounded-xl border text-left transition-all duration-300 group
                      ${isSelected ? `bg-white/[0.08] ${platform.color} shadow-lg ${platform.glowColor}` : 'bg-black/40 border-white/[0.06] text-gray-400 hover:bg-white/[0.04]'}
                    `}
                  >
                    {isSelected && (
                      <span className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50" />
                    )}
                    <div className="relative z-10 flex items-center gap-2">
                      <span className="text-lg filter drop-shadow-md">{platform.emoji}</span>
                      <span className="text-xs font-semibold tracking-wide">{platform.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Intent Dump Section */}
          <div className="space-y-4 relative z-10">
            <label className="text-sm font-semibold text-indigo-300 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> Smart Intent Dump
            </label>
            <textarea
              placeholder="e.g. 'I want to find roofing companies in Texas, and also check Reddit for people complaining about roof leaks.'"
              value={intentDump}
              onChange={(e) => setIntentDump(e.target.value)}
              rows={4}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500/50 transition-all text-sm placeholder:text-gray-600 shadow-inner resize-y"
            />
            
            <AnimatePresence>
              {selectedPlatforms.includes('gmaps') && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2"
                >
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-emerald-300 uppercase tracking-wider flex items-center gap-2">
                      <Target className="w-3 h-3" /> Business Category (Niche)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="e.g. Plumbers, Roofing, Software Agencies"
                        value={niche}
                        onChange={(e) => setNiche(e.target.value)}
                        className="w-full bg-black/40 border border-emerald-500/30 rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500/50 transition-all text-sm placeholder:text-gray-600 shadow-inner"
                      />
                      <Target className="w-4 h-4 text-emerald-500/50 absolute left-3.5 top-3.5" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-emerald-300 uppercase tracking-wider flex items-center gap-2">
                      <MapPin className="w-3 h-3" /> Target Location
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="e.g. Austin, TX or London, UK"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        className="w-full bg-black/40 border border-emerald-500/30 rounded-xl pl-10 pr-10 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500/50 transition-all text-sm placeholder:text-gray-600 shadow-inner"
                      />
                      <MapPin className="w-4 h-4 text-emerald-500/50 absolute left-3.5 top-3.5" />
                      <button
                        type="button"
                        onClick={() => {
                          if (navigator.geolocation) {
                            navigator.geolocation.getCurrentPosition(pos => {
                               setLocation(`${pos.coords.latitude}, ${pos.coords.longitude}`);
                            });
                          }
                        }}
                        className="absolute right-3 top-3 p-0.5 text-emerald-500/50 hover:text-emerald-400 transition-colors"
                        title="Use my current location"
                      >
                        <Navigation className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={handleAnalyzeIntent}
              disabled={isAnalyzingIntent || !intentDump.trim()}
              className={`
                px-6 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 text-white
                ${isAnalyzingIntent || !intentDump.trim()
                  ? 'bg-indigo-600/50 cursor-not-allowed opacity-70'
                  : 'bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/25 active:scale-95'
                }
              `}
            >
              {isAnalyzingIntent ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing Intent...</>
              ) : (
                <><Zap className="w-4 h-4" /> Generate Options</>
              )}
            </button>
          </div>

          <AnimatePresence>
            {generatedOptions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4 pt-4 border-t border-white/10 relative z-10"
              >
                <label className="text-sm font-semibold text-cyan-300 uppercase tracking-wider">
                  Select Options to Scrape
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {generatedOptions.map((opt, idx) => {
                    const isSelected = selectedOptionIndices.includes(idx);
                    const badge = getPlatformBadge(opt.platform);
                    return (
                      <div
                        key={idx}
                        onClick={() => toggleOption(idx)}
                        className={`
                          cursor-pointer p-4 rounded-xl border transition-all duration-200 flex items-start gap-3
                          ${isSelected ? 'bg-cyan-500/10 border-cyan-500/40 shadow-[0_0_15px_rgba(34,211,238,0.1)]' : 'bg-white/5 border-white/10 hover:border-white/20'}
                        `}
                      >
                        <div className="mt-0.5 text-cyan-400">
                          {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{opt.label}</span>
                            <span className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded-full border ${badge.colorClass}`}>
                              {badge.emoji} {badge.label}
                            </span>
                          </div>
                          {opt.niche && opt.location && (
                            <p className="text-xs text-gray-400">Targeting "{opt.niche}" in {opt.location}</p>
                          )}
                          {opt.keyword && (
                            <p className="text-xs text-gray-400">Searching for "{opt.keyword}"</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Execute Section */}
          <motion.form
            onSubmit={handleScrape}
            className="space-y-4 pt-6 border-t border-white/10 relative z-10"
          >
            <div className="flex flex-col md:flex-row items-end gap-4">
              <div className="w-full md:w-1/3 space-y-2">
                <label className="text-xs font-semibold text-purple-200 uppercase tracking-wider flex items-center gap-2">
                  <Star className="w-3 h-3" /> Max Leads per Option
                </label>
                <input
                  id="input-limit"
                  type="number"
                  min="1"
                  max="200"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500/50 transition-all text-sm placeholder:text-gray-600 shadow-inner"
                  required
                />
              </div>

              <div className="w-full md:w-2/3">
                <button
                  id="btn-run-engine"
                  type="submit"
                  disabled={isScraping || selectedOptionIndices.length === 0}
                  className={`
                    w-full h-[46px] rounded-xl font-medium transition-all flex items-center justify-center gap-2 text-white relative overflow-hidden
                    ${isScraping
                      ? 'bg-gradient-to-r from-emerald-600 to-cyan-600 btn-pulse cursor-wait'
                      : 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-cyan-600 hover:shadow-lg hover:shadow-emerald-500/25 hover:scale-[1.02] active:scale-[0.98]'
                    }
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                >
                  {!isScraping && (
                    <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-200%] hover:translate-x-[200%] transition-transform duration-700" />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    {isScraping ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Scraping {selectedOptionIndices.length} option(s)...</>
                    ) : (
                      <><Target className="w-4 h-4" /> Run Engine for {selectedOptionIndices.length} option(s)</>
                    )}
                  </span>
                </button>
              </div>
            </div>
          </motion.form>
        </motion.section>

        {/* ─── Progress Dashboard ─── */}
        <AnimatePresence>
          {(isScraping || stage === 'complete' || stage === 'error') && (
            <motion.section
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.98 }}
              transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="relative"
            >
              <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 space-y-6 shadow-2xl relative overflow-hidden">
                {isScraping && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-0 left-1/4 w-96 h-32 bg-indigo-500/5 rounded-full blur-3xl" />
                    <div className="absolute bottom-0 right-1/4 w-96 h-32 bg-cyan-500/5 rounded-full blur-3xl" />
                  </div>
                )}
                <div className="relative z-10">
                  <div className="flex items-center justify-between">
                    {PIPELINE_STAGES.map((s, idx) => {
                      const isActive = s.key === stage;
                      const isCompleted = currentStageIdx > idx;
                      const isError = stage === 'error' && idx === currentStageIdx;
                      return (
                        <div key={s.key} className="flex items-center flex-1 last:flex-initial">
                          <div className="flex flex-col items-center gap-2 relative">
                            <div
                              className={`
                                w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 relative
                                ${isActive
                                  ? 'bg-indigo-500/20 border-2 border-indigo-400 text-indigo-300 shadow-lg shadow-indigo-500/20'
                                  : isCompleted
                                    ? 'bg-emerald-500/20 border-2 border-emerald-400 text-emerald-300'
                                    : isError
                                      ? 'bg-red-500/20 border-2 border-red-400 text-red-300'
                                      : 'bg-white/5 border-2 border-white/10 text-gray-600'
                                }
                              `}
                            >
                              {isActive && (
                                <span className="absolute inset-0 rounded-full animate-ping bg-indigo-500/30" style={{ animationDuration: '2s' }} />
                              )}
                              <span className="relative z-10">
                                {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : s.icon}
                              </span>
                            </div>
                            <span
                              className={`
                                text-[11px] font-semibold tracking-wide whitespace-nowrap
                                ${isActive
                                  ? 'text-indigo-300'
                                  : isCompleted
                                    ? 'text-emerald-400'
                                    : 'text-gray-600'
                                }
                              `}
                            >
                              {s.label}
                            </span>
                          </div>
                          {idx < PIPELINE_STAGES.length - 1 && (
                            <div className="flex-1 h-[2px] mx-3 rounded-full relative overflow-hidden mt-[-22px]">
                              <div className="absolute inset-0 bg-white/[0.06]" />
                              <motion.div
                                className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-full"
                                initial={{ width: '0%' }}
                                animate={{ width: isCompleted ? '100%' : isActive ? '50%' : '0%' }}
                                transition={{ duration: 0.6, ease: 'easeOut' }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="relative z-10 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-black/40 backdrop-blur-sm border border-white/[0.06] rounded-xl p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                      <Clock className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">Elapsed</p>
                      <p className="text-lg font-mono font-bold text-white tabular-nums">{formatTime(elapsed)}</p>
                    </div>
                  </div>
                  <div className="bg-black/40 backdrop-blur-sm border border-white/[0.06] rounded-xl p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                      <Target className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">Leads</p>
                      <p className="text-lg font-mono font-bold text-white tabular-nums">
                        {leads.length} <span className="text-gray-500 text-sm font-normal">/ {totalLimit}</span>
                      </p>
                    </div>
                  </div>
                  <div className="bg-black/40 backdrop-blur-sm border border-white/[0.06] rounded-xl p-4 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      stage === 'complete' ? 'bg-emerald-500/10 border border-emerald-500/20' : stage === 'error' ? 'bg-red-500/10 border border-red-500/20' : 'bg-purple-500/10 border border-purple-500/20'
                    }`}>
                      <Activity className={`w-4 h-4 ${stage === 'complete' ? 'text-emerald-400' : stage === 'error' ? 'text-red-400' : 'text-purple-400'}`} />
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">Stage</p>
                      <p className={`text-sm font-bold capitalize ${stage === 'complete' ? 'text-emerald-400' : stage === 'error' ? 'text-red-400' : 'text-indigo-300'}`}>
                        {PIPELINE_STAGES.find(s => s.key === stage)?.label || stage}
                      </p>
                    </div>
                  </div>
                  <div className="bg-black/40 backdrop-blur-sm border border-white/[0.06] rounded-xl p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                      <Zap className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">Processing</p>
                      <p className="text-sm font-medium text-white truncate max-w-[160px]">
                        {currentLeadName || (stage === 'complete' ? 'Done' : 'Waiting...')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="relative z-10 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-cyan-400 truncate max-w-[70%]">&gt; {progress}</span>
                    <span className="text-gray-500 font-mono tabular-nums">{Math.round(progressPercent)}%</span>
                  </div>
                  <div className="w-full h-2 bg-white/[0.04] rounded-full overflow-hidden border border-white/[0.06]">
                    <motion.div
                      className={`h-full rounded-full relative ${
                        stage === 'complete' ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : stage === 'error' ? 'bg-gradient-to-r from-red-500 to-red-400' : 'bg-gradient-to-r from-indigo-500 via-cyan-500 to-indigo-500'
                      }`}
                      initial={{ width: '0%' }}
                      animate={{ width: isScraping && leads.length === 0 ? '5%' : `${progressPercent}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    >
                      {isScraping && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite] bg-[length:200%_100%]" />}
                    </motion.div>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Inbox Style Leads View */}
        <AnimatePresence>
          {leads.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              <motion.h2
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-xl font-semibold flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Live Inbox ({leads.length})
              </motion.h2>

              <motion.div
                className="grid grid-cols-1 gap-4"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                <AnimatePresence mode="popLayout">
                  {leads.map((lead) => {
                    const badge = getPlatformBadge(lead.platform || 'gmaps');
                    const isSocialLead = lead.platform && lead.platform !== 'gmaps';
                    const isJobLead = lead.kind === 'job' || lead.platform === 'upwork';

                    return (
                      <motion.div
                        key={lead.id}
                        variants={cardVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        layout
                        className={`
                          group
                          bg-white/[0.04] backdrop-blur-md
                          border border-white/[0.08]
                          rounded-2xl p-6
                          transition-all duration-300 ease-out
                          shadow-lg
                          hover:bg-white/[0.07]
                          hover:border-white/[0.18]
                          hover:shadow-indigo-500/10 hover:shadow-xl
                          hover:scale-[1.005]
                          flex flex-col md:flex-row gap-6
                        `}
                      >
                        <div className="flex-1 space-y-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="text-xl font-bold flex items-center gap-2 flex-wrap">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase font-bold rounded-full border ${badge.colorClass}`}>
                                  {badge.emoji} {badge.label}
                                </span>
                                {lead.title || lead.name}
                                {!lead.website && !isSocialLead && (
                                  <span className="px-2 py-0.5 text-[10px] uppercase font-bold bg-red-500/20 text-red-400 rounded-full flex items-center gap-1 border border-red-500/30">
                                    <ShieldAlert className="w-3 h-3" /> No Website
                                  </span>
                                )}
                                {lead.is_claimed === false && (
                                  <span className="px-2 py-0.5 text-[10px] uppercase font-bold bg-purple-500/20 text-purple-400 rounded-full flex items-center gap-1 border border-purple-500/30">
                                    <Target className="w-3 h-3" /> Unclaimed
                                  </span>
                                )}
                              </h3>
                              {!isSocialLead && lead.address && (
                                <p className="text-gray-400 text-sm mt-1">{lead.address}</p>
                              )}
                              {isSocialLead && (
                                <div className="mt-2 space-y-1.5">
                                  {lead.author && (
                                    <p className="text-sm text-gray-400 flex items-center gap-1.5">
                                      <User className="w-3.5 h-3.5 text-gray-500" />
                                      <span className="font-medium text-gray-300">@{lead.author}</span>
                                    </p>
                                  )}
                                  {lead.post_content && (
                                    <p className="text-sm text-gray-400 leading-relaxed line-clamp-3 bg-white/[0.03] rounded-lg p-3 border border-white/[0.05]">
                                      {lead.post_content.slice(0, 200)}{lead.post_content.length > 200 ? '…' : ''}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className={`
                              flex flex-col items-center justify-center w-20 h-20 rounded-xl shrink-0 gap-1 p-2
                              bg-black/50 backdrop-blur-sm
                              border transition-all duration-500
                              ${lead.lead_category === 'Diamond'
                                ? 'border-cyan-400/50 bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 shadow-[0_0_25px_rgba(34,211,238,0.25)]'
                                : lead.lead_category === 'Gold'
                                  ? 'border-yellow-500/40 bg-gradient-to-br from-yellow-500/10 to-orange-500/10 shadow-[0_0_15px_rgba(234,179,8,0.2)]'
                                  : 'border-white/10'
                              }
                            `}>
                              <span className={`text-2xl font-bold ${lead.lead_score >= 8 ? 'text-green-400' : lead.lead_score >= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {lead.lead_score || '-'}
                              </span>
                              {lead.lead_category === 'Diamond' && <span className="text-[10px] font-bold uppercase text-cyan-300 flex items-center gap-1"><Gem className="w-3 h-3"/> Diamond</span>}
                              {lead.lead_category === 'Gold' && <span className="text-[10px] font-bold uppercase text-yellow-500 flex items-center gap-1"><Trophy className="w-3 h-3"/> Gold</span>}
                              {lead.lead_category === 'Junk' && <span className="text-[10px] font-bold uppercase text-gray-500 flex items-center gap-1"><Trash2 className="w-3 h-3"/> Junk</span>}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300">
                            {!isSocialLead && lead.rating && (
                              <div className="flex items-center gap-1 bg-white/5 px-2.5 py-1 rounded-md border border-white/10">
                                <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                                <span className="font-medium text-white">{lead.rating}</span>
                                <span className="text-gray-500 ml-1">({lead.reviews})</span>
                              </div>
                            )}
                            {lead.phone && (
                              <div className="bg-white/5 px-2.5 py-1 rounded-md border border-white/10">
                                {lead.phone}
                              </div>
                            )}
                            {lead.website && (
                              <a href={lead.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md border border-white/10 text-cyan-400 transition-colors">
                                <ExternalLink className="w-3.5 h-3.5" /> Website
                              </a>
                            )}
                            {isSocialLead && lead.post_url && (
                              <a
                                id={`view-post-${lead.id}`}
                                href={lead.post_url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 px-3 py-1.5 rounded-lg border border-indigo-500/30 text-indigo-300 font-semibold text-xs transition-all hover:shadow-lg hover:shadow-indigo-500/10"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                {isJobLead ? 'View Job' : 'View Original Post'}
                              </a>
                            )}
                            {lead.emails_found && lead.emails_found.length > 0 && (
                              <div className="flex items-center gap-1 bg-indigo-500/20 px-2.5 py-1 rounded-md border border-indigo-500/30 text-indigo-300">
                                <Mail className="w-3.5 h-3.5" /> {lead.emails_found[0]}
                              </div>
                            )}
                            {lead.socials && lead.socials.length > 0 && lead.socials.map((social, idx) => (
                              <a key={idx} href={social} target="_blank" rel="noreferrer" className="flex items-center gap-1 bg-blue-500/20 hover:bg-blue-500/30 px-2.5 py-1 rounded-md border border-blue-500/30 text-blue-300 transition-colors">
                                <ExternalLink className="w-3 h-3" /> {new URL(social).hostname.replace('www.', '')}
                              </a>
                            ))}
                          </div>
                        </div>
                        <div className="flex-1 bg-gradient-to-br from-white/[0.03] to-white/[0.01] backdrop-blur-sm border border-white/5 rounded-xl p-5 space-y-4 relative overflow-hidden group-hover:border-white/10 transition-all duration-500">
                          <div className="absolute -top-6 -right-6 p-3 opacity-[0.03] text-indigo-500 group-hover:scale-110 group-hover:rotate-12 transition-transform duration-700">
                            <Zap className="w-40 h-40" />
                          </div>
                          <div className="relative z-10 border-l-2 border-indigo-500/50 pl-4">
                            <h4 className="text-[11px] font-bold text-indigo-400 uppercase tracking-widest mb-1.5 flex items-center gap-2"><Target className="w-3 h-3"/> AI Rationale</h4>
                            <p className="text-sm text-gray-300 leading-relaxed">{lead.rationale || 'Awaiting analysis...'}</p>
                          </div>
                          <div className="relative z-10 border-l-2 border-cyan-500/50 pl-4 pt-1 mt-4">
                            <h4 className="text-[11px] font-bold text-cyan-400 uppercase tracking-widest mb-2 flex items-center gap-2"><Mail className="w-3 h-3"/> Suggested Pitch</h4>
                            <p className="text-sm text-white font-medium italic bg-white/5 p-3.5 rounded-lg border border-white/10 shadow-inner leading-relaxed">"{lead.suggested_pitch || '...'}"</p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </main>
  );
}
