"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Save, CheckCircle2, Eye, EyeOff, Trash2, Shield, Cpu, Zap, ExternalLink, Info, Database, Plus, RefreshCw, Globe } from 'lucide-react';

type SerperKey = { masked: string; tail: string; exhausted: boolean; active: boolean; source?: string };

const PROVIDERS = [
  { id: 'nim', name: 'NVIDIA NIM', icon: <Cpu className="w-5 h-5" />, color: 'emerald' },
  { id: 'openai', name: 'OpenAI', icon: <Database className="w-5 h-5" />, color: 'indigo' },
  { id: 'gemini', name: 'Google Gemini', icon: <Zap className="w-5 h-5" />, color: 'cyan' },
];

const MODELS: Record<string, string[]> = {
  nim: ['meta/llama-3.1-8b-instruct', 'meta/llama-3.1-70b-instruct'],
  openai: ['gpt-4o-mini', 'gpt-4o'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
};

const DEFAULT_MODELS: Record<string, string> = {
  nim: 'meta/llama-3.1-8b-instruct',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
};

export default function SettingsPage() {
  const [activeProvider, setActiveProvider] = useState('nim');
  const [keys, setKeys] = useState<Record<string, string>>({ nim: '', openai: '', gemini: '' });
  const [models, setModels] = useState<Record<string, string>>(DEFAULT_MODELS);
  
  const [showKey, setShowKey] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

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
    const provider = localStorage.getItem('ai_provider') || 'nim';
    setActiveProvider(provider);

    setKeys({
      nim: localStorage.getItem('nim_api_key') || '',
      openai: localStorage.getItem('openai_api_key') || '',
      gemini: localStorage.getItem('gemini_api_key') || '',
    });

    setModels({
      nim: localStorage.getItem('nim_model') || DEFAULT_MODELS.nim,
      openai: localStorage.getItem('openai_model') || DEFAULT_MODELS.openai,
      gemini: localStorage.getItem('gemini_model') || DEFAULT_MODELS.gemini,
    });

    loadSerperKeys();
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

  const handleClearKey = (providerId: string) => {
    const newKeys = { ...keys, [providerId]: '' };
    setKeys(newKeys);
    localStorage.removeItem(`${providerId}_api_key`);
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
        <p className="text-white/50 text-sm mt-3 max-w-xl leading-relaxed">
          Configure your AI reasoning engine. Add API keys and select models for advanced personalized pitches and lead scoring. Local-first, highly secure.
        </p>
      </motion.header>

      {/* Provider Selection */}
      <motion.section 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="space-y-4"
      >
        <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest ml-1">Active Engine</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PROVIDERS.map((provider) => {
            const isActive = activeProvider === provider.id;
            const hasKey = !!keys[provider.id]?.trim();
            const colorMap: Record<string, string> = {
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

            {/* API Key Input */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-2">
                  <Shield className="w-3 h-3" /> API Key
                </label>
                <a 
                  href={
                    activeProvider === 'nim' ? "https://build.nvidia.com/explore/discover" :
                    activeProvider === 'openai' ? "https://platform.openai.com/api-keys" :
                    "https://aistudio.google.com/app/apikey"
                  }
                  target="_blank" 
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Get API Key <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500/20 to-cyan-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-500" />
                <input
                  type={showKey ? 'text' : 'password'}
                  placeholder={`Enter your ${PROVIDERS.find(p => p.id === activeProvider)?.name} API Key...`}
                  value={keys[activeProvider]}
                  onChange={(e) => {
                    setKeys({ ...keys, [activeProvider]: e.target.value });
                    setIsSaved(false);
                  }}
                  className="relative w-full bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl px-5 py-4 pr-24 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-sm font-mono placeholder:text-white/15 shadow-inner"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white/80"
                    title={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  {keys[activeProvider] && (
                    <button
                      onClick={() => handleClearKey(activeProvider)}
                      className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-white/40 hover:text-red-400"
                      title="Clear key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 mt-2 rounded-lg bg-indigo-500/5 border border-indigo-500/10 text-[11px] text-indigo-200/60">
                <Info className="w-3 h-3 text-indigo-400 shrink-0" />
                Keys are stored locally in your browser and never sent to any external server.
              </div>
            </div>
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
