"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, MapPin, Target, Download, Loader2, Mail, ExternalLink, Star, StarHalf, ShieldAlert, Key, Gem, Trophy, Trash2, Clock, Radio, CheckCircle2, Zap, ArrowRight, Activity } from 'lucide-react';
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
  { key: 'scraping', label: 'Scraping Maps', icon: <Search className="w-4 h-4" /> },
  { key: 'analyzing', label: 'AI Analysis', icon: <Zap className="w-4 h-4" /> },
  { key: 'saving', label: 'Saving', icon: <Download className="w-4 h-4" /> },
  { key: 'complete', label: 'Complete', icon: <CheckCircle2 className="w-4 h-4" /> },
];

function getStageIndex(stage: Stage): number {
  const idx = PIPELINE_STAGES.findIndex((s) => s.key === stage);
  return idx === -1 ? -1 : idx;
}

/* ── Elapsed timer hook ── */
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
  const [niche, setNiche] = useState('');
  const [location, setLocation] = useState('');
  const [limit, setLimit] = useState<number>(10);
  const [isScraping, setIsScraping] = useState(false);
  const [leads, setLeads] = useState<ScoredLead[]>([]);
  const [progress, setProgress] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [aiProvider, setAiProvider] = useState('nim');
  const [aiModel, setAiModel] = useState('meta/llama-3.1-8b-instruct');

  // Stage tracking
  const [stage, setStage] = useState<Stage>('idle');
  const [currentLeadName, setCurrentLeadName] = useState<string>('');

  // Elapsed timer
  const elapsed = useElapsedTimer(isScraping);

  // Location Autocomplete State
  const [suggestions, setSuggestions] = useState<{display_name: string}[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const suggestionRef = useRef<HTMLDivElement>(null);

  // Load API key and config from local storage on mount
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

  // Handle clicking outside of suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (suggestionRef.current && !suggestionRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle location input change
  const handleLocationChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocation(val);
    
    if (val.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsSearchingLocation(true);
    setShowSuggestions(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&limit=5&featuretype=city`);
      const data = await res.json();
      setSuggestions(data);
    } catch (err) {
      console.error("Location search failed", err);
    } finally {
      setIsSearchingLocation(false);
    }
  };

  const selectSuggestion = (name: string) => {
    // Simplify "City, County, State, Country" to "City, State" if possible, or just use the first few parts
    const parts = name.split(',').map(p => p.trim());
    const simpleName = parts.length > 2 ? `${parts[0]}, ${parts[parts.length - 2]}` : name;
    
    setLocation(simpleName);
    setShowSuggestions(false);
  };

  // Derive stage from progress messages
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

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!niche || !location) return;

    setIsScraping(true);
    setLeads([]);
    setProgress('Initializing scraper...');
    setStage('connecting');
    setCurrentLeadName('');

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche, location, limit, apiKey, aiProvider, aiModel }),
      });

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
              setIsScraping(false);
              setCurrentLeadName('');
            } else if (parsed.type === 'error') {
              setProgress(`Error: ${parsed.message}`);
              setIsScraping(false);
              setCurrentLeadName('');
            }
          } catch (err) {
            console.error('Error parsing NDJSON line:', line, err);
          }
        }
      }
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
        Score: l.lead_score,
        Category: l.lead_category || '',
        Business_Category: l.category || '',
        Rating: l.rating || '',
        Reviews: l.reviews || '',
        Phone: l.phone || '',
        Website: l.website || '',
        Emails: l.emails_found?.join(', ') || '',
        Pitch: l.suggested_pitch || '',
        Rationale: l.rationale || '',
      }));
      
      const headers = Object.keys(csvData[0]);
      const csvRows = [];
      csvRows.push(headers.join(','));
      
      for (const row of csvData) {
        const values = headers.map(header => {
          const val = (row as any)[header] || '';
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
      a.download = `${niche}-${location}-leads.csv`.replace(/\s+/g, '_');
      a.click();
    } catch (err) {
      console.error(err);
      alert('Failed to export CSV');
    }
  };

  const currentStageIdx = getStageIndex(stage);
  const progressPercent = leads.length > 0 ? Math.min((leads.length / limit) * 100, 100) : 0;

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-white p-8 font-sans selection:bg-indigo-500/30">
      <motion.div
        className="max-w-7xl mx-auto space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        
        {/* Header */}
        <motion.header
          variants={itemVariants}
          className="flex flex-col md:flex-row items-center justify-between gap-6 pb-8 border-b border-white/10"
        >
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              GMaps Lead Machine
            </h1>
            <p className="text-gray-400 text-sm">Find, analyze, and extract high-intent B2B leads.</p>
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
                  onClick={exportCSV}
                  className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-full transition-all text-sm font-medium backdrop-blur-sm"
                >
                  <Download className="w-4 h-4" /> Export CSV ({leads.length})
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.header>

        {/* Form Container — animated gradient border — NO overflow-hidden */}
        <motion.section
          variants={itemVariants}
          className="animated-gradient-border bg-white/[0.03] p-6 rounded-2xl backdrop-blur-xl shadow-2xl space-y-6 relative"
        >
          {/* Subtle radial glow behind form */}
          <div className="absolute -top-32 -right-32 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex items-center gap-2 mb-2 relative z-10">
            <span className={`w-2 h-2 rounded-full ${isScraping ? 'bg-cyan-500' : 'bg-green-500'} animate-pulse`}></span>
            <span className="text-xs font-semibold text-gray-400 tracking-wider">
              {isScraping ? 'Engine Running' : 'Engine Ready'}
            </span>
          </div>

          <motion.form
            onSubmit={handleScrape}
            className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end relative z-10"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Niche Field */}
            <motion.div variants={itemVariants} className="space-y-3 relative">
              <label className="text-xs font-semibold text-indigo-200 uppercase tracking-wider flex items-center gap-2">
                <Target className="w-3 h-3" /> Niche
              </label>
              <input
                type="text"
                placeholder="e.g. Plumbers, Roofers..."
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500/50 transition-all text-sm placeholder:text-gray-600 shadow-inner"
                required
              />
            </motion.div>

            {/* Location Field */}
            <motion.div variants={itemVariants} className="space-y-3 relative" ref={suggestionRef}>
              <label className="text-xs font-semibold text-cyan-200 uppercase tracking-wider flex items-center gap-2">
                <MapPin className="w-3 h-3" /> Location
              </label>
              <input
                type="text"
                placeholder="e.g. Austin, TX"
                value={location}
                onChange={handleLocationChange}
                onFocus={() => { if (location.length >= 3) setShowSuggestions(true); }}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500/50 transition-all text-sm placeholder:text-gray-600 shadow-inner"
                required
                autoComplete="off"
              />
              
              {/* Autocomplete Dropdown */}
              <AnimatePresence>
                {showSuggestions && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="absolute z-50 w-full mt-1 bg-gray-900/95 border border-white/10 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl"
                  >
                    {isSearchingLocation ? (
                      <div className="p-4 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Searching places...
                      </div>
                    ) : suggestions.length > 0 ? (
                      <ul className="max-h-60 overflow-y-auto">
                        {suggestions.map((s, i) => (
                          <li 
                            key={i} 
                            onClick={() => selectSuggestion(s.display_name)}
                            className="px-4 py-3 text-sm text-gray-300 hover:bg-white/10 cursor-pointer border-b border-white/5 last:border-0 transition-colors flex items-start gap-2"
                          >
                            <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-cyan-500" />
                            <span>{s.display_name}</span>
                          </li>
                        ))}
                      </ul>
                    ) : location.length >= 3 ? (
                      <div className="p-4 text-center text-gray-500 text-sm">
                        No matching locations found.
                      </div>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Max Leads Field */}
            <motion.div variants={itemVariants} className="space-y-3">
              <label className="text-xs font-semibold text-purple-200 uppercase tracking-wider flex items-center gap-2">
                <Star className="w-3 h-3" /> Max Leads
              </label>
              <input
                type="number"
                min="1"
                max="200"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500/50 transition-all text-sm placeholder:text-gray-600 shadow-inner"
                required
              />
            </motion.div>

            {/* Run Engine Button */}
            <motion.div variants={itemVariants}>
              <button
                type="submit"
                disabled={isScraping}
                className={`
                  w-full h-[46px] rounded-xl font-medium transition-all flex items-center justify-center gap-2 text-white relative overflow-hidden
                  ${isScraping
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 btn-pulse cursor-wait'
                    : 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-600 hover:shadow-lg hover:shadow-indigo-500/25 hover:scale-[1.02] active:scale-[0.98]'
                  }
                  disabled:opacity-70
                `}
              >
                {/* Shimmer overlay on hover */}
                {!isScraping && (
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-200%] hover:translate-x-[200%] transition-transform duration-700" />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  {isScraping ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Scraping...</>
                  ) : (
                    <><Search className="w-4 h-4" /> Run Engine</>
                  )}
                </span>
              </button>
            </motion.div>
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

                {/* Background glow when active */}
                {isScraping && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-0 left-1/4 w-96 h-32 bg-indigo-500/5 rounded-full blur-3xl" />
                    <div className="absolute bottom-0 right-1/4 w-96 h-32 bg-cyan-500/5 rounded-full blur-3xl" />
                  </div>
                )}

                {/* ── Stage Pipeline ── */}
                <div className="relative z-10">
                  <div className="flex items-center justify-between">
                    {PIPELINE_STAGES.map((s, idx) => {
                      const isActive = s.key === stage;
                      const isCompleted = currentStageIdx > idx;
                      const isError = stage === 'error' && idx === currentStageIdx;

                      return (
                        <div key={s.key} className="flex items-center flex-1 last:flex-initial">
                          {/* Stage node */}
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
                              {/* Glow ring for active stage */}
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

                          {/* Connector line */}
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

                {/* ── Stats Row ── */}
                <div className="relative z-10 grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Elapsed Time */}
                  <div className="bg-black/40 backdrop-blur-sm border border-white/[0.06] rounded-xl p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                      <Clock className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">Elapsed</p>
                      <p className="text-lg font-mono font-bold text-white tabular-nums">{formatTime(elapsed)}</p>
                    </div>
                  </div>

                  {/* Leads Found */}
                  <div className="bg-black/40 backdrop-blur-sm border border-white/[0.06] rounded-xl p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                      <Target className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">Leads</p>
                      <p className="text-lg font-mono font-bold text-white tabular-nums">
                        {leads.length} <span className="text-gray-500 text-sm font-normal">/ {limit}</span>
                      </p>
                    </div>
                  </div>

                  {/* Current Stage */}
                  <div className="bg-black/40 backdrop-blur-sm border border-white/[0.06] rounded-xl p-4 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      stage === 'complete' 
                        ? 'bg-emerald-500/10 border border-emerald-500/20' 
                        : stage === 'error'
                          ? 'bg-red-500/10 border border-red-500/20'
                          : 'bg-purple-500/10 border border-purple-500/20'
                    }`}>
                      <Activity className={`w-4 h-4 ${
                        stage === 'complete' ? 'text-emerald-400' : stage === 'error' ? 'text-red-400' : 'text-purple-400'
                      }`} />
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">Stage</p>
                      <p className={`text-sm font-bold capitalize ${
                        stage === 'complete' ? 'text-emerald-400' : stage === 'error' ? 'text-red-400' : 'text-indigo-300'
                      }`}>
                        {PIPELINE_STAGES.find(s => s.key === stage)?.label || stage}
                      </p>
                    </div>
                  </div>

                  {/* Processing */}
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

                {/* ── Progress Bar ── */}
                <div className="relative z-10 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-cyan-400 truncate max-w-[70%]">&gt; {progress}</span>
                    <span className="text-gray-500 font-mono tabular-nums">{Math.round(progressPercent)}%</span>
                  </div>
                  <div className="w-full h-2 bg-white/[0.04] rounded-full overflow-hidden border border-white/[0.06]">
                    <motion.div
                      className={`h-full rounded-full relative ${
                        stage === 'complete'
                          ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                          : stage === 'error'
                            ? 'bg-gradient-to-r from-red-500 to-red-400'
                            : 'bg-gradient-to-r from-indigo-500 via-cyan-500 to-indigo-500'
                      }`}
                      initial={{ width: '0%' }}
                      animate={{ width: isScraping && leads.length === 0 ? '5%' : `${progressPercent}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    >
                      {/* Shimmer effect on active bar */}
                      {isScraping && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite] bg-[length:200%_100%]" />
                      )}
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
                  {leads.map((lead) => (
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
                      
                      {/* Left Column: Basic Info */}
                      <div className="flex-1 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="text-xl font-bold flex items-center gap-2">
                              {lead.name}
                              {!lead.website && (
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
                            <p className="text-gray-400 text-sm mt-1">{lead.address}</p>
                          </div>
                          
                          {/* Score Badge */}
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
                          {lead.rating && (
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

                      {/* Right Column: AI Analysis */}
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
                  ))}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </main>
  );
}
