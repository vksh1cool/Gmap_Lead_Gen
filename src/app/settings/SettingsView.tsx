"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Save, CheckCircle2, Trash2, Cpu, Zap, ExternalLink, Info, Database, Plus, RefreshCw, Globe } from 'lucide-react';

type SerperKey = { masked: string; tail: string; exhausted: boolean; active: boolean; source?: string };

const PROVIDERS = [
  { id: 'groq', name: 'Groq (fast)', icon: <Zap className="w-5 h-5" />, color: 'orange' },
  { id: 'nim', name: 'NVIDIA NIM', icon: <Cpu className="w-5 h-5" />, color: 'emerald' },
  { id: 'openai', name: 'OpenAI', icon: <Database className="w-5 h-5" />, color: 'indigo' },
  { id: 'gemini', name: 'Google Gemini', icon: <Zap className="w-5 h-5" />, color: 'cyan' },
];

const MODELS: Record<string, string[]> = {
  // Smart-by-default, with reasoning options for tougher qualification.
  groq: [
    'llama-3.3-70b-versatile',
    'deepseek-r1-distill-llama-70b',
    'openai/gpt-oss-120b',
    'moonshotai/kimi-k2-instruct',
    'llama-3.1-8b-instant',
  ],
  nim: [
    'meta/llama-3.3-70b-instruct',
    'deepseek-ai/deepseek-r1',
    'qwen/qwen2.5-72b-instruct',
    'meta/llama-3.1-70b-instruct',
    'meta/llama-3.1-8b-instruct',
  ],
  openai: ['gpt-4o-mini', 'gpt-4o', 'o1-mini'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
};

const DEFAULT_MODELS: Record<string, string> = {
  groq: 'llama-3.3-70b-versatile',
  nim: 'meta/llama-3.3-70b-instruct',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
};

export default function SettingsPage() {
  const [activeProvider, setActiveProvider] = useState('groq');
  const [keys, setKeys] = useState<Record<string, string>>({ groq: '', nim: '', openai: '', gemini: '' });
  const [models, setModels] = useState<Record<string, string>>(DEFAULT_MODELS);
  
  const [isSaved, setIsSaved] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // ── AI key pool (many Groq + NIM keys, rotated + failed-over together) ──
  type AiPoolKey = { id: string; provider: string; masked: string; model: string; source: string; exhausted: boolean; cooling: boolean; available: boolean; reason: string };
  const [aiKeys, setAiKeys] = useState<AiPoolKey[]>([]);
  const [aiByProvider, setAiByProvider] = useState<Record<string, { total: number; available: number }>>({});
  const [newAiProvider, setNewAiProvider] = useState('groq');
  const [newAiKey, setNewAiKey] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  const loadAiKeys = async () => {
    try {
      const r = await fetch('/api/ai-keys', { cache: 'no-store' });
      const d = await r.json();
      if (Array.isArray(d.keys)) setAiKeys(d.keys);
      setAiByProvider(d.byProvider || {});
      if (d.cache) setAiCache(d.cache);
    } catch {
      setAiError('Could not load AI key pool.');
    }
  };

  const addAiKey = async () => {
    const key = newAiKey.trim();
    if (key.length < 8) { setAiError('That key looks too short.'); return; }
    setAiBusy(true); setAiError('');
    try {
      const r = await fetch('/api/ai-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: newAiProvider, key }),
      });
      const d = await r.json();
      if (d.error) setAiError(d.error);
      else { setAiKeys(d.keys || []); setAiByProvider(d.byProvider || {}); setNewAiKey(''); }
    } catch { setAiError('Request failed — is the app server running?'); }
    setAiBusy(false);
  };

  const removeAiKey = async (id: string) => {
    setAiBusy(true);
    try {
      const r = await fetch(`/api/ai-keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const d = await r.json();
      if (Array.isArray(d.keys)) { setAiKeys(d.keys); setAiByProvider(d.byProvider || {}); }
    } catch { setAiError('Request failed.'); }
    setAiBusy(false);
  };

  const resetAiKeys = async () => {
    setAiBusy(true);
    try {
      const r = await fetch(`/api/ai-keys?action=reset`, { method: 'DELETE' });
      const d = await r.json();
      if (Array.isArray(d.keys)) { setAiKeys(d.keys); setAiByProvider(d.byProvider || {}); }
    } catch { setAiError('Request failed.'); }
    setAiBusy(false);
  };

  const [aiCache, setAiCache] = useState<{ entries: number; hits: number; misses: number; hitRate: number } | null>(null);

  const clearAiCache = async () => {
    setAiBusy(true);
    try {
      const r = await fetch('/api/ai-keys?action=clear-cache', { method: 'DELETE' });
      const d = await r.json();
      if (d.cache) setAiCache(d.cache);
    } catch { /* ignore */ }
    setAiBusy(false);
  };

  // ── Database (Neon serverless URL) ──
  type DbStatus = { configured: boolean; ok: boolean; source: string | null; masked?: string; error?: string };
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [dbUrl, setDbUrl] = useState('');
  const [dbBusy, setDbBusy] = useState(false);
  const [dbError, setDbError] = useState('');
  const [dbSaved, setDbSaved] = useState(false);

  const loadDbStatus = async () => {
    try {
      const r = await fetch('/api/db-config', { cache: 'no-store' });
      setDbStatus(await r.json());
    } catch { setDbStatus({ configured: false, ok: false, source: null }); }
  };

  const saveDbUrlConfig = async () => {
    const url = dbUrl.trim();
    if (!url) { setDbError('Paste your Neon connection URL.'); return; }
    setDbBusy(true); setDbError(''); setDbSaved(false);
    try {
      const r = await fetch('/api/db-config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      });
      const d = await r.json();
      if (d.error) setDbError(d.error);
      else { setDbStatus(d); setDbUrl(''); setDbSaved(true); setTimeout(() => setDbSaved(false), 3000); }
    } catch { setDbError('Request failed.'); }
    setDbBusy(false);
  };

  const clearDbUrlConfig = async () => {
    setDbBusy(true); setDbError('');
    try {
      const r = await fetch('/api/db-config', { method: 'DELETE' });
      setDbStatus(await r.json());
    } catch { setDbError('Request failed.'); }
    setDbBusy(false);
  };

  // ── Serper key pool (auto-rotation across free 2,500-credit accounts) ──
  const [serperKeys, setSerperKeys] = useState<SerperKey[]>([]);
  const [newSerperKey, setNewSerperKey] = useState('');
  const [serperBusy, setSerperBusy] = useState(false);
  const [serperError, setSerperError] = useState('');

  const loadSerperKeys = async () => {
    try {
      const r = await fetch('/api/serper-keys', { cache: 'no-store' });
      const d = await r.json();
      if (Array.isArray(d.keys)) setSerperKeys(d.keys);
      setSerperError(d?.error || '');
    } catch {
      setSerperError('Scraping engine not reachable (start uvicorn on :8000).');
    }
  };

  const addSerperKey = async () => {
    const key = newSerperKey.trim();
    if (key.length < 8) { setSerperError('That key looks too short.'); return; }
    setSerperBusy(true); setSerperError('');
    try {
      const r = await fetch('/api/serper-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
      });
      const d = await r.json();
      if (d.error) setSerperError(d.error);
      else { setSerperKeys(d.keys || []); setNewSerperKey(''); }
    } catch { setSerperError('Scraping engine not reachable.'); }
    setSerperBusy(false);
  };

  const removeSerperKey = async (tail: string) => {
    setSerperBusy(true);
    try {
      const r = await fetch(`/api/serper-keys?tail=${encodeURIComponent(tail)}`, { method: 'DELETE' });
      const d = await r.json();
      if (Array.isArray(d.keys)) setSerperKeys(d.keys);
    } catch { setSerperError('Scraping engine not reachable.'); }
    setSerperBusy(false);
  };

  useEffect(() => {
    setIsMounted(true);
    const provider = localStorage.getItem('ai_provider') || 'groq';
    setActiveProvider(provider);

    setKeys({
      groq: localStorage.getItem('groq_api_key') || '',
      nim: localStorage.getItem('nim_api_key') || '',
      openai: localStorage.getItem('openai_api_key') || '',
      gemini: localStorage.getItem('gemini_api_key') || '',
    });

    setModels({
      groq: localStorage.getItem('groq_model') || DEFAULT_MODELS.groq,
      nim: localStorage.getItem('nim_model') || DEFAULT_MODELS.nim,
      openai: localStorage.getItem('openai_model') || DEFAULT_MODELS.openai,
      gemini: localStorage.getItem('gemini_model') || DEFAULT_MODELS.gemini,
    });

    loadSerperKeys();
    loadAiKeys();
    loadDbStatus();
  }, []);

  const handleSave = () => {
    localStorage.setItem('ai_provider', activeProvider);
    
    Object.entries(keys).forEach(([p, k]) => {
      if (k.trim()) localStorage.setItem(`${p}_api_key`, k.trim());
      else localStorage.removeItem(`${p}_api_key`);
    });

    Object.entries(models).forEach(([p, m]) => {
      localStorage.setItem(`${p}_model`, m);
    });

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  if (!isMounted) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-10 py-10 px-6 selection:bg-indigo-500/30">
      
      {/* Header */}
      <motion.header 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="pb-8 border-b border-white/10"
      >
        <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
          Multi-LLM Brain
        </h1>
        <p className="text-white/50 text-sm mt-3 max-w-2xl leading-relaxed">
          Configure your AI reasoning engine for personalized pitches and lead scoring. Keys set here live in your browser.
          <span className="text-white/70"> Tip: dropping <code className="text-orange-300">groq_api_key</code> or <code className="text-emerald-300">nim_key</code> in <code className="text-white/80">.env.local</code> auto-powers the AI server-side — no UI setup needed.</span>
        </p>
      </motion.header>

      {/* ── Database (unified lead store) ── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-black/40 backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-8 space-y-6 relative overflow-hidden shadow-2xl"
      >
        <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-4 border-b border-white/5 pb-6">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/15 flex items-center justify-center border border-sky-500/20 shadow-inner">
              <Database className="w-6 h-6 text-sky-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white tracking-tight">Database</h2>
              <p className="text-sm text-white/40 mt-0.5">
                Every lead from every source lands in one unified Postgres table. Point it at a free Neon serverless database.
              </p>
            </div>
            {/* Status pill */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold shrink-0 ${
              dbStatus?.ok ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : dbStatus?.configured ? 'bg-red-500/15 border-red-500/30 text-red-300'
              : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
            }`}>
              <span className={`w-2 h-2 rounded-full ${dbStatus?.ok ? 'bg-emerald-400' : dbStatus?.configured ? 'bg-red-400' : 'bg-amber-400'}`} />
              {dbStatus?.ok ? 'Connected' : dbStatus?.configured ? 'Error' : 'Not configured'}
            </div>
          </div>

          {dbStatus?.configured && (
            <div className="mt-6 flex items-center gap-3 flex-wrap text-sm">
              <span className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 font-mono text-white/60">{dbStatus.masked || '••••'}</span>
              <span className="text-xs text-white/40">
                source: <b className="text-white/70">{dbStatus.source === 'env' ? '.env.local (DATABASE_URL)' : 'saved in-app'}</b>
              </span>
              {dbStatus.source === 'saved' && (
                <button onClick={clearDbUrlConfig} disabled={dbBusy} className="text-xs text-white/40 hover:text-red-400 underline">clear</button>
              )}
              {dbStatus.error && <span className="text-xs text-red-400 w-full">{dbStatus.error}</span>}
            </div>
          )}

          {dbStatus?.source === 'env' ? (
            <div className="flex items-start gap-2 px-4 py-3 mt-5 rounded-xl bg-sky-500/5 border border-sky-500/10 text-[12px] text-sky-100/70">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span><b className="text-white/80">DATABASE_URL</b> is set in your environment — that's the shared-with-the-team setup and it takes precedence. To change it, edit <code className="text-white/80">.env.local</code>.</span>
            </div>
          ) : (
            <>
              <div className="mt-5 flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  placeholder="postgresql://user:password@ep-xxx.neon.tech/neondb?sslmode=require"
                  value={dbUrl}
                  onChange={(e) => { setDbUrl(e.target.value); setDbError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveDbUrlConfig(); }}
                  className="flex-1 bg-black/80 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-transparent transition text-sm font-mono placeholder:text-white/15"
                />
                <button onClick={saveDbUrlConfig} disabled={dbBusy || !dbUrl.trim()}
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-black font-bold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed">
                  {dbBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : dbSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {dbSaved ? 'Saved' : 'Test & Save'}
                </button>
              </div>
              {dbError && <p className="mt-2 text-xs text-red-400">{dbError}</p>}
              <div className="flex items-center gap-2 px-3 py-2 mt-3 rounded-lg bg-sky-500/5 border border-sky-500/10 text-[11px] text-sky-200/60">
                <Info className="w-3 h-3 text-sky-400 shrink-0" />
                Recommended for teams: put <code className="text-white/70">DATABASE_URL</code> in <code className="text-white/70">.env.local</code> and share that file. Or paste a URL here (validated + stored server-side, gitignored). Get one free at <a href="https://neon.tech" target="_blank" rel="noreferrer" className="underline hover:text-sky-300">neon.tech</a>.
              </div>
            </>
          )}
        </div>
      </motion.section>

      {/* Provider Selection */}
      <motion.section 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="space-y-4"
      >
        <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest ml-1">Active Engine</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {PROVIDERS.map((provider) => {
            const isActive = activeProvider === provider.id;
            const hasKey = (aiByProvider[provider.id]?.available || 0) > 0;
            const colorMap: Record<string, string> = {
              orange: 'from-orange-500/20 to-orange-500/5 border-orange-500/30 text-orange-400 ring-orange-500/50',
              emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30 text-emerald-400 ring-emerald-500/50',
              indigo: 'from-indigo-500/20 to-indigo-500/5 border-indigo-500/30 text-indigo-400 ring-indigo-500/50',
              cyan: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/30 text-cyan-400 ring-cyan-500/50',
            };
            const activeColors = colorMap[provider.color];

            return (
              <motion.button
                key={provider.id}
                onClick={() => { setActiveProvider(provider.id); setIsSaved(false); }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`
                  relative p-5 rounded-2xl border text-left transition-all duration-300 overflow-hidden
                  ${isActive 
                    ? `bg-gradient-to-br ${activeColors} ring-1 shadow-lg shadow-${provider.color}-500/10` 
                    : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04] hover:border-white/20'
                  }
                `}
              >
                {isActive && (
                  <div className={`absolute -right-6 -top-6 w-24 h-24 bg-${provider.color}-500/20 rounded-full blur-2xl`} />
                )}
                <div className="flex items-center justify-between relative z-10">
                  <div className={`p-2.5 rounded-xl ${isActive ? `bg-${provider.color}-500/20` : 'bg-white/5'}`}>
                    {provider.icon}
                  </div>
                  {hasKey && <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />}
                </div>
                <div className="mt-4 relative z-10">
                  <h3 className={`font-bold ${isActive ? 'text-white' : 'text-white/70'}`}>{provider.name}</h3>
                  <p className="text-[11px] text-white/40 mt-1 uppercase tracking-wide">
                    {hasKey ? 'Ready' : 'Requires API Key'}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </motion.section>

      {/* Configuration Section */}
      <motion.section 
        key={activeProvider}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-black/40 backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-8 space-y-8 relative overflow-hidden shadow-2xl"
      >
        {/* Glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center gap-4 border-b border-white/5 pb-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 flex items-center justify-center border border-indigo-500/20 shadow-inner">
              <Key className="w-6 h-6 text-indigo-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white tracking-tight">{PROVIDERS.find(p => p.id === activeProvider)?.name} Configuration</h2>
              <p className="text-sm text-white/40 mt-0.5">Set up your API key and model preferences.</p>
            </div>
          </div>

          <div className="mt-8 space-y-6">
            {/* Model Selection */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-2">
                <Cpu className="w-3 h-3" /> Selected Model
              </label>
              <select
                value={models[activeProvider]}
                onChange={(e) => {
                  setModels({ ...models, [activeProvider]: e.target.value });
                  setIsSaved(false);
                }}
                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all text-sm text-white appearance-none cursor-pointer"
                style={{ WebkitAppearance: 'none' }}
              >
                {MODELS[activeProvider].map(model => (
                  <option key={model} value={model} className="bg-gray-900 text-white">{model}</option>
                ))}
              </select>
            </div>

            {/* Preferred model note — keys themselves live in the pool below */}
            <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-indigo-500/5 border border-indigo-500/15 text-[12px] text-indigo-100/70">
              <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                This sets the <b className="text-white/80">preferred</b> provider + model to try first.
                Add the actual API keys — as many Groq &amp; NIM keys as you want — in the <b className="text-white/80">AI Key Pool</b> below.
                The engine rotates across every key and fails over automatically.
              </span>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ── AI Key Pool (many Groq + NIM keys, rotated together) ── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="bg-black/40 backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-8 space-y-6 relative overflow-hidden shadow-2xl"
      >
        <div className="absolute top-0 right-0 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-4 border-b border-white/5 pb-6">
            <div className="w-12 h-12 rounded-2xl bg-orange-500/15 flex items-center justify-center border border-orange-500/20 shadow-inner">
              <Cpu className="w-6 h-6 text-orange-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white tracking-tight">AI Key Pool</h2>
              <p className="text-sm text-white/40 mt-0.5">
                Add as many Groq &amp; NIM (or OpenAI / Gemini) keys as you want. The engine rotates across all of them and fails over on quota/rate limits — so scoring never stalls.
              </p>
            </div>
          </div>

          {/* Summary */}
          <div className="mt-6 flex items-center gap-3 flex-wrap">
            <div className="px-4 py-2 rounded-xl bg-orange-500/10 border border-orange-500/20">
              <span className="text-2xl font-black text-orange-400 tabular-nums">{aiKeys.filter(k => k.available).length}</span>
              <span className="text-xs text-white/50 ml-2">key{aiKeys.filter(k => k.available).length !== 1 ? 's' : ''} ready</span>
            </div>
            {Object.entries(aiByProvider).map(([prov, s]) => (
              <div key={prov} className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 text-xs">
                <span className="font-bold text-white/80 uppercase">{prov}</span>
                <span className="text-white/40 ml-2">{s.available}/{s.total}</span>
              </div>
            ))}
            {aiCache && (
              <div className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 text-xs" title="Cached AI answers reused instead of spending credits">
                <span className="font-bold text-white/80">🧠 {aiCache.entries}</span>
                <span className="text-white/40 ml-2">cached · {aiCache.hitRate}% hit</span>
                {(aiCache.entries > 0 || aiCache.hits > 0) && (
                  <button onClick={clearAiCache} disabled={aiBusy} className="ml-2 text-white/30 hover:text-red-400 underline">clear</button>
                )}
              </div>
            )}
            <button onClick={loadAiKeys} disabled={aiBusy}
              className="ml-auto p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition disabled:opacity-40" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${aiBusy ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Key list */}
          <div className="mt-5 space-y-2">
            {aiKeys.length === 0 && (
              <div className="text-center py-6 text-sm text-white/30">
                No AI keys yet. Add a Groq or NIM key below — without one, leads still get scored by the built-in rule engine (no AI pitches).
              </div>
            )}
            {aiKeys.map((k) => {
              const provColor: Record<string, string> = {
                groq: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
                nim: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
                openai: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25',
                gemini: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
              };
              return (
                <div key={k.id}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                    k.available ? 'bg-white/[0.03] border-white/10'
                    : k.exhausted ? 'bg-red-500/[0.04] border-red-500/15'
                    : 'bg-amber-500/[0.04] border-amber-500/15'}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border shrink-0 ${provColor[k.provider] || 'bg-white/10 text-white/50 border-white/20'}`}>{k.provider}</span>
                    <span className="font-mono text-sm text-white/70 truncate">{k.masked}</span>
                    <span className="text-[10px] text-white/30 hidden md:inline truncate">{k.model}</span>
                    {k.source === 'env' && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-white/5 text-white/40 shrink-0">.env</span>}
                    {k.available && <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 shrink-0">Ready</span>}
                    {k.cooling && <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 shrink-0">Cooling</span>}
                    {k.exhausted && <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 shrink-0" title={k.reason}>Disabled</span>}
                  </div>
                  <button onClick={() => removeAiKey(k.id)} disabled={aiBusy}
                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 transition disabled:opacity-40 shrink-0" title="Remove">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add key */}
          <div className="mt-5 flex flex-col sm:flex-row gap-2">
            <select
              value={newAiProvider}
              onChange={(e) => { setNewAiProvider(e.target.value); setAiError(''); }}
              className="bg-black/80 border border-white/10 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 sm:w-40"
            >
              <option value="groq" className="bg-gray-900">Groq</option>
              <option value="nim" className="bg-gray-900">NVIDIA NIM</option>
              <option value="openai" className="bg-gray-900">OpenAI</option>
              <option value="gemini" className="bg-gray-900">Gemini</option>
            </select>
            <input
              type="text"
              placeholder="Paste an API key — it's live-validated before adding…"
              value={newAiKey}
              onChange={(e) => { setNewAiKey(e.target.value); setAiError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') addAiKey(); }}
              className="flex-1 bg-black/80 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-transparent transition text-sm font-mono placeholder:text-white/15"
            />
            <button onClick={addAiKey} disabled={aiBusy || !newAiKey.trim()}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-black font-bold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed">
              {aiBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
            </button>
          </div>
          {aiError && <p className="mt-2 text-xs text-red-400">{aiError}</p>}
          <div className="flex items-center justify-between gap-2 mt-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/5 border border-orange-500/10 text-[11px] text-orange-200/60">
              <Info className="w-3 h-3 text-orange-400 shrink-0" />
              Keys are stored server-side in a gitignored file and used only to call the providers you chose. Get keys: <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="underline hover:text-orange-300">Groq</a> · <a href="https://build.nvidia.com" target="_blank" rel="noreferrer" className="underline hover:text-orange-300">NIM</a>.
            </div>
            {aiKeys.some(k => k.exhausted || k.cooling) && (
              <button onClick={resetAiKeys} disabled={aiBusy}
                className="text-xs text-white/40 hover:text-white/70 underline shrink-0">Re-enable all</button>
            )}
          </div>
        </div>
      </motion.section>

      {/* ── Serper Search Key Pool (auto-rotation) ── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-black/40 backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-8 space-y-6 relative overflow-hidden shadow-2xl"
      >
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-4 border-b border-white/5 pb-6">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 flex items-center justify-center border border-emerald-500/20 shadow-inner">
              <Globe className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white tracking-tight">Serper Search Keys</h2>
              <p className="text-sm text-white/40 mt-0.5">
                Powers LinkedIn / Instagram / Quora / Upwork / Reddit / ProductHunt. Auto-rotates when a key runs out.
              </p>
            </div>
            <a href="https://serper.dev/api-keys" target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors shrink-0">
              Get a free key <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Status summary */}
          <div className="mt-6 flex items-center gap-4 flex-wrap">
            <div className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <span className="text-2xl font-black text-emerald-400 tabular-nums">
                {serperKeys.filter(k => !k.exhausted).length}
              </span>
              <span className="text-xs text-white/50 ml-2">active key{serperKeys.filter(k => !k.exhausted).length !== 1 ? 's' : ''}</span>
            </div>
            <div className="px-4 py-2 rounded-xl bg-white/[0.03] border border-white/10">
              <span className="text-2xl font-black text-white tabular-nums">
                ~{(serperKeys.filter(k => !k.exhausted).length * 2500).toLocaleString()}
              </span>
              <span className="text-xs text-white/50 ml-2">searches left</span>
            </div>
            <button onClick={loadSerperKeys} disabled={serperBusy}
              className="ml-auto p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition disabled:opacity-40"
              title="Refresh">
              <RefreshCw className={`w-4 h-4 ${serperBusy ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Key list */}
          <div className="mt-5 space-y-2">
            {serperKeys.length === 0 && (
              <div className="text-center py-6 text-sm text-white/30">
                No Serper keys yet. Add one below — the dork platforms fall back to (rate-limited) keyless search without it.
              </div>
            )}
            {serperKeys.map((k) => (
              <div key={k.tail}
                className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                  k.active ? 'bg-emerald-500/[0.07] border-emerald-500/25'
                  : k.exhausted ? 'bg-red-500/[0.04] border-red-500/15'
                  : 'bg-white/[0.02] border-white/10'}`}>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-white/70">{k.masked}</span>
                  {k.active && <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">In use</span>}
                  {k.exhausted && <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-red-500/15 text-red-300">Exhausted</span>}
                  {!k.active && !k.exhausted && <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white/10 text-white/40">Standby</span>}
                </div>
                <button onClick={() => removeSerperKey(k.tail)} disabled={serperBusy}
                  className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 transition disabled:opacity-40" title="Remove">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Add key */}
          <div className="mt-5 flex gap-2">
            <input
              type="text"
              placeholder="Paste a new Serper API key (from a fresh free account)…"
              value={newSerperKey}
              onChange={(e) => { setNewSerperKey(e.target.value); setSerperError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') addSerperKey(); }}
              className="flex-1 bg-black/80 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent transition text-sm font-mono placeholder:text-white/15"
            />
            <button onClick={addSerperKey} disabled={serperBusy || !newSerperKey.trim()}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          {serperError && <p className="mt-2 text-xs text-red-400">{serperError}</p>}
          <div className="flex items-center gap-2 px-3 py-2 mt-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-[11px] text-emerald-200/60">
            <Info className="w-3 h-3 text-emerald-400 shrink-0" />
            Each free Serper account = 2,500 searches. When one exhausts, create another free account, paste its key here, and the engine keeps going — no restart needed.
          </div>
        </div>
      </motion.section>

      {/* Save Button */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="flex justify-end pt-4"
      >
        <button
          onClick={handleSave}
          className={`
            relative overflow-hidden group flex items-center gap-3 px-8 py-4 rounded-2xl font-bold transition-all duration-300 text-sm shadow-xl
            ${isSaved
              ? 'bg-emerald-500 text-white shadow-emerald-500/25'
              : 'bg-white text-black hover:bg-gray-100 hover:scale-[1.02] shadow-white/10'
            }
          `}
        >
          {isSaved ? (
            <>
              <CheckCircle2 className="w-5 h-5" />
              Settings Saved Successfully
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              Save AI Configuration
              <div className="absolute inset-0 h-full w-full bg-gradient-to-r from-transparent via-black/5 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
            </>
          )}
        </button>
      </motion.div>

    </div>
  );
}
