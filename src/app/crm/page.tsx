"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Mail, Globe, Brain, User, Target, ChevronDown, Phone, MapPin, Search, Trash2, ChevronRight, Briefcase, ExternalLink } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// Smart link detection
function detectLinkType(url: string): { type: string; label: string; color: string; hoverColor: string } {
  if (!url) return { type: 'website', label: 'Website', color: 'text-blue-400', hoverColor: 'hover:bg-blue-500/20 hover:border-blue-500/30' };
  const lower = url.toLowerCase();
  if (lower.includes('instagram.com')) return { type: 'instagram', label: 'Instagram', color: 'text-pink-400', hoverColor: 'hover:bg-pink-500/20 hover:border-pink-500/30' };
  if (lower.includes('facebook.com') || lower.includes('fb.com')) return { type: 'facebook', label: 'Facebook', color: 'text-blue-500', hoverColor: 'hover:bg-blue-600/20 hover:border-blue-600/30' };
  if (lower.includes('twitter.com') || lower.includes('x.com')) return { type: 'twitter', label: 'Twitter/X', color: 'text-sky-400', hoverColor: 'hover:bg-sky-500/20 hover:border-sky-500/30' };
  if (lower.includes('youtube.com')) return { type: 'youtube', label: 'YouTube', color: 'text-red-500', hoverColor: 'hover:bg-red-500/20 hover:border-red-500/30' };
  if (lower.includes('linkedin.com')) return { type: 'linkedin', label: 'LinkedIn', color: 'text-blue-400', hoverColor: 'hover:bg-blue-500/20 hover:border-blue-500/30' };
  if (lower.includes('tiktok.com')) return { type: 'tiktok', label: 'TikTok', color: 'text-white', hoverColor: 'hover:bg-white/10 hover:border-white/20' };
  if (lower.includes('yelp.com')) return { type: 'yelp', label: 'Yelp', color: 'text-red-400', hoverColor: 'hover:bg-red-500/20 hover:border-red-500/30' };
  return { type: 'website', label: 'Website', color: 'text-blue-400', hoverColor: 'hover:bg-blue-500/20 hover:border-blue-500/30' };
}

function getLinkIcon(type: string, size: number = 14) {
  switch (type) {
    case 'instagram': 
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>;
    case 'facebook': 
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>;
    case 'twitter': 
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"></path></svg>;
    case 'youtube': 
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>;
    case 'linkedin': 
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>;
    case 'tiktok':
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"></path></svg>;
    default: 
      return <Globe size={size} />;
  }
}

interface Lead {
  id: string;
  name: string;
  website?: string;
  phone?: string;
  status: string;
  lead_score?: number;
  lead_category?: string;
  emails_found?: any;
  socials?: any;
  about_snippet?: string;
  suggested_pitch?: string;
  suggested_subject?: string;
  batch_id?: string;
  search_query?: string;
  scraped_at?: string;
  address?: string;
}

const STATUS_COLORS: Record<string, string> = {
  "Uncontacted": "text-gray-400 bg-gray-500/10 border-gray-500/20",
  "Emailed": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "Closed": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
};

export default function CRMPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/leads");
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || data || []);
      }
    } catch (error) {
      console.error("Failed to fetch leads:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateStatus = async (id: string, newStatus: string) => {
    setUpdatingId(id);
    try {
      const res = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (res.ok) {
        setLeads((prev) =>
          prev.map((lead) => (lead.id === id ? { ...lead, status: newStatus } : lead))
        );
      }
    } catch (error) {
      console.error("Failed to update status:", error);
    } finally {
      setUpdatingId(null);
    }
  };

  const deleteLead = async (id: string) => {
    if (!confirm("Are you sure you want to delete this lead?")) return;
    try {
      const res = await fetch(`/api/leads?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setLeads((prev) => prev.filter((lead) => lead.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete lead:", error);
    }
  };

  const clearAllLeads = async () => {
    if (!confirm("Are you sure you want to delete ALL leads? This action cannot be undone.")) return;
    try {
      const res = await fetch("/api/leads", { method: "DELETE" });
      if (res.ok) {
        setLeads([]);
      }
    } catch (error) {
      console.error("Failed to clear leads:", error);
    }
  };

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = lead.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (lead.about_snippet || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (lead.search_query || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "All" || lead.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Group leads by batch_id
  const groupedLeads: Record<string, { batch_id: string, search_query: string, scraped_at: string, leads: Lead[] }> = {};
  
  filteredLeads.forEach(lead => {
    const batchId = lead.batch_id || 'manual_entry';
    if (!groupedLeads[batchId]) {
      groupedLeads[batchId] = {
        batch_id: batchId,
        search_query: lead.search_query || 'Unknown Search',
        scraped_at: lead.scraped_at || new Date().toISOString(),
        leads: []
      };
    }
    groupedLeads[batchId].leads.push(lead);
  });

  const batches = Object.values(groupedLeads).sort((a, b) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime());

  return (
    <div className="space-y-8 pb-12">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Pipeline</h1>
          <p className="text-muted-foreground mt-2 font-medium">
            Manage your high-intent local leads. Close deals faster.
          </p>
        </div>
        {leads.length > 0 && (
          <button 
            onClick={clearAllLeads}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-sm font-bold transition-all shadow-sm"
          >
            <Trash2 size={16} />
            Nuke All Leads
          </button>
        )}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 md:p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <input
            type="text"
            placeholder="Search leads, categories, or snippets..."
            className="w-full pl-11 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none transition-all text-white placeholder:text-white/30"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
          {["All", "Uncontacted", "Emailed", "Closed"].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                statusFilter === status 
                  ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 border border-indigo-400" 
                  : "bg-white/5 border border-white/10 hover:bg-white/10 text-white/70"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground bg-white/5 border border-white/10 rounded-3xl backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mb-6" />
          <span className="font-semibold text-lg tracking-wide">Syncing database...</span>
        </div>
      ) : batches.length === 0 ? (
        <div className="text-center py-32 text-muted-foreground border border-dashed border-white/10 rounded-3xl bg-white/[0.02] backdrop-blur-sm">
          <Target className="h-16 w-16 mx-auto mb-6 opacity-30 text-indigo-400" />
          <h3 className="text-xl font-bold text-white mb-2">No leads in the pipeline</h3>
          <p className="max-w-md mx-auto opacity-70">
            {leads.length === 0 
              ? "Your pipeline is empty. Jump over to the Hunter and start scraping."
              : "No leads match your current search criteria."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <AnimatePresence>
            {batches.map((batch, batchIdx) => (
              <BatchGroup 
                key={batch.batch_id} 
                batch={batch} 
                batchIdx={batchIdx} 
                updateStatus={updateStatus} 
                deleteLead={deleteLead} 
                updatingId={updatingId} 
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function BatchGroup({ batch, batchIdx, updateStatus, deleteLead, updatingId }: any) {
  const [isExpanded, setIsExpanded] = useState(batchIdx === 0); // Open first batch by default

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(batchIdx * 0.1, 0.5) }}
      className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md overflow-hidden"
    >
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-5 md:p-6 bg-white/5 hover:bg-white/10 transition-colors text-left"
      >
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-500/20 rounded-xl">
            <Briefcase className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">{batch.search_query}</h2>
            <p className="text-sm text-white/50 font-medium mt-1">
              Scraped on {format(new Date(batch.scraped_at), "MMM d, yyyy 'at' h:mm a")} • {batch.leads.length} Leads
            </p>
          </div>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="p-2 bg-white/5 rounded-full"
        >
          <ChevronRight className="h-5 w-5 text-white/70" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="border-t border-white/10 bg-white/[0.02]"
          >
            <div className="p-5 md:p-6 grid grid-cols-1 gap-5">
              {batch.leads.map((lead: any) => (
                <LeadCard 
                  key={lead.id} 
                  lead={lead} 
                  updateStatus={updateStatus} 
                  deleteLead={deleteLead} 
                  updatingId={updatingId} 
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function LeadCard({ lead, updateStatus, deleteLead, updatingId }: any) {
  const [isExpanded, setIsExpanded] = useState(false);

  const parseJsonArray = (data: any): string[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  };

  const emails = parseJsonArray(lead.emails_found);
  const socials = parseJsonArray(lead.socials);

  // Generate safe URLs for buttons
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.name + " " + (lead.address || ""))}`;
  const mailToUrl = emails.length > 0 ? `mailto:${emails[0]}?subject=${encodeURIComponent(lead.suggested_subject || `Quick question about ${lead.name}`)}&body=${encodeURIComponent(lead.suggested_pitch || "")}` : "#";
  const telUrl = lead.phone ? `tel:${lead.phone.replace(/[^0-9+]/g, '')}` : "#";
  const websiteUrl = lead.website ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) : "#";

  return (
    <motion.div layout className="bg-card/40 border border-white/10 rounded-2xl p-5 shadow-lg relative overflow-hidden group">
      <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500/50 group-hover:bg-indigo-400 transition-colors"></div>
      
      {/* Header Info */}
      <div className="flex flex-col xl:flex-row gap-5 justify-between items-start xl:items-center pl-3">
        <div className="space-y-3 flex-1 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-extrabold text-xl text-white group-hover:text-indigo-300 transition-colors">{lead.name}</h3>
            {lead.lead_score !== null && lead.lead_score !== undefined && (
              <span className={`px-3 py-1 rounded-full text-xs font-black border tracking-wide uppercase ${
                lead.lead_score >= 8 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]' :
                lead.lead_score >= 5 ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' :
                'bg-red-500/20 text-red-400 border-red-500/40'
              }`}>
                Score: {lead.lead_score}/10
              </span>
            )}
            {lead.lead_category && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-white/10 text-white/90 border border-white/20 uppercase tracking-wide">
                {lead.lead_category}
              </span>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {lead.website && (() => {
              const linkInfo = detectLinkType(lead.website);
              return (
                <a href={websiteUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 ${linkInfo.hoverColor} border border-white/10 rounded-lg text-xs font-semibold text-white/80 transition-colors`}>
                  <span className={linkInfo.color}>{getLinkIcon(linkInfo.type)}</span> {linkInfo.label}
                </a>
              );
            })()}
            {!lead.website && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs font-bold text-red-400">
                <Globe size={14} /> No Website
              </span>
            )}
            {lead.phone && (
              <a href={telUrl} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-emerald-500/20 hover:border-emerald-500/30 border border-white/10 rounded-lg text-xs font-semibold text-white/80 transition-colors">
                <Phone size={14} className="text-emerald-400" /> {lead.phone}
              </a>
            )}
            {emails.length > 0 && (
              <a href={mailToUrl} onClick={(e) => { e.stopPropagation(); updateStatus(lead.id, "Emailed"); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-indigo-500/20 hover:border-indigo-500/30 border border-white/10 rounded-lg text-xs font-semibold text-white/80 transition-colors">
                <Mail size={14} className="text-indigo-400" /> {emails[0]}
              </a>
            )}
            <a href={mapUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-red-500/20 hover:border-red-500/30 border border-white/10 rounded-lg text-xs font-semibold text-white/80 transition-colors">
              <MapPin size={14} className="text-red-400" /> GMaps
            </a>
            {/* Show social links from the socials array too */}
            {socials.length > 0 && socials.map((social: string, idx: number) => {
              const socialInfo = detectLinkType(social);
              // Don't duplicate if same as website
              if (lead.website && social.toLowerCase().includes(new URL(lead.website.startsWith('http') ? lead.website : `https://${lead.website}`).hostname.replace('www.', ''))) return null;
              return (
                <a key={idx} href={social.startsWith('http') ? social : `https://${social}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 ${socialInfo.hoverColor} border border-white/10 rounded-lg text-xs font-semibold text-white/80 transition-colors`}>
                  <span className={socialInfo.color}>{getLinkIcon(socialInfo.type)}</span> {socialInfo.label}
                </a>
              );
            })}
          </div>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-3 w-full xl:w-auto mt-4 xl:mt-0 relative pl-3 xl:pl-0 border-t xl:border-t-0 border-white/10 pt-4 xl:pt-0">
          <div className="relative w-full xl:w-48">
            <select
              className={`appearance-none w-full pl-4 pr-10 py-3 rounded-xl text-sm font-bold border focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all cursor-pointer ${STATUS_COLORS[lead.status] || STATUS_COLORS['Uncontacted']} ${updatingId === lead.id ? 'opacity-50' : ''}`}
              value={lead.status || 'Uncontacted'}
              onChange={(e) => updateStatus(lead.id, e.target.value)}
              disabled={updatingId === lead.id}
            >
              <option value="Uncontacted" className="bg-[#0f1423] text-white font-semibold">Status: Uncontacted</option>
              <option value="Emailed" className="bg-[#0f1423] text-white font-semibold">Status: Emailed</option>
              <option value="Closed" className="bg-[#0f1423] text-white font-semibold">Status: Closed</option>
            </select>
            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
            {updatingId === lead.id && (
              <Loader2 size={14} className="absolute right-10 top-1/2 -translate-y-1/2 animate-spin text-white" />
            )}
          </div>
          
          <button
            onClick={(e) => { e.stopPropagation(); deleteLead(lead.id); }}
            className="p-3 rounded-xl border border-red-500/20 text-red-500 hover:bg-red-500/10 transition-colors bg-black/20"
            title="Delete Lead"
          >
            <Trash2 size={18} />
          </button>
          
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-3 rounded-xl border border-white/10 text-white/50 hover:bg-white/5 hover:text-white transition-colors bg-black/20 hidden xl:block"
          >
            <motion.div animate={{ rotate: isExpanded ? 180 : 0 }}>
              <ChevronDown size={18} />
            </motion.div>
          </button>
        </div>
      </div>

      {/* Expanded AI Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-6 mt-6 border-t border-white/10 pl-3">
              {/* Pitch Box */}
              <div className="space-y-3 bg-indigo-500/5 p-5 rounded-2xl border border-indigo-500/20 relative group/pitch">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-black text-indigo-400 uppercase tracking-widest">
                    <Target size={14} /> AI Pitch Draft
                  </div>
                  {emails.length > 0 && (
                     <a
                       href={mailToUrl}
                       className="inline-flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shadow-[0_0_15px_rgba(99,102,241,0.3)]"
                       onClick={() => updateStatus(lead.id, "Emailed")}
                     >
                       <Mail size={12} /> Send Email Now
                     </a>
                  )}
                </div>
                {lead.suggested_subject && (
                  <div className="text-sm font-semibold text-white/90 border-b border-indigo-500/20 pb-2 mb-2">
                    <span className="text-white/40 font-normal mr-2">Subject:</span>
                    {lead.suggested_subject}
                  </div>
                )}
                <div className="text-sm text-white/80 leading-relaxed font-medium whitespace-pre-wrap">
                  {lead.suggested_pitch || "No pitch generated."}
                </div>
              </div>

              {/* Rationale / About Box */}
              <div className="space-y-4">
                {lead.rationale && (
                  <div className="space-y-2 bg-white/5 p-4 rounded-xl border border-white/10">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
                      <Brain size={14} /> Qualification Rationale
                    </div>
                    <p className="text-sm text-white/70 leading-relaxed font-medium">
                      {lead.rationale}
                    </p>
                  </div>
                )}
                
                {lead.about_snippet && (
                  <div className="space-y-2 bg-white/5 p-4 rounded-xl border border-white/10">
                    <div className="flex items-center gap-2 text-xs font-bold text-white/50 uppercase tracking-wider">
                      <MapPin size={14} /> About Snippet
                    </div>
                    <p className="text-sm text-white/60 leading-relaxed">
                      {lead.about_snippet}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
