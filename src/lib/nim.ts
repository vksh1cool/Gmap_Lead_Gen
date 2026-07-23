import { RawLead, ScoredLead } from './types';
import { chatComplete, availableProviders, AiProvider } from './aiKeyPool';

// Preference hint carried from the UI/client into every LLM call. Keys come
// from the server-side pool; these just bias which provider/model to try first,
// plus an optional advanced client-key override.
export interface AiPref {
  preferProvider?: string;
  preferModel?: string;
  clientKey?: string;
  clientProvider?: AiProvider;
  clientModel?: string;
  /** What the user sells — makes the scorer rank buyers of THIS, not just websites. */
  offer?: string;
}

// Default offer when the user hasn't set one. Kept broad so out-of-the-box the
// tool still hunts the agency's bread-and-butter leads; overridden per-session
// from the UI's "What I sell" field to make the whole engine niche-agnostic.
export const DEFAULT_OFFER =
  'web development, SEO, and AI automation (websites, landing pages, e-commerce, chatbots)';

function offerOf(pref: AiPref): string {
  return (pref.offer || '').trim() || DEFAULT_OFFER;
}

/**
 * Smart rule-based scoring engine. Works without any API key.
 * Analyzes actual lead data to produce accurate scores.
 */
// Social media domains that don't count as a "real" website
const SOCIAL_DOMAINS = ['instagram.com', 'facebook.com', 'fb.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'linkedin.com', 'pinterest.com', 'yelp.com'];

function isSocialMediaUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return SOCIAL_DOMAINS.some(d => lower.includes(d));
}

function detectLinkType(url: string): 'instagram' | 'facebook' | 'twitter' | 'youtube' | 'linkedin' | 'tiktok' | 'yelp' | 'website' {
  if (!url) return 'website';
  const lower = url.toLowerCase();
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.includes('facebook.com') || lower.includes('fb.com')) return 'facebook';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  if (lower.includes('youtube.com')) return 'youtube';
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('yelp.com')) return 'yelp';
  return 'website';
}

function ruleBasedScore(lead: RawLead): { score: number; category: string; rationale: string; pitch: string; subject: string } {
  const isSocialPost = lead.category === 'Social Post' || (lead.kind && lead.kind !== 'business_listing');
  const isJobListing = lead.kind === 'job';

  if (isSocialPost && !isJobListing) {
    const content = (lead.post_content || lead.about_snippet || '').toLowerCase();
    let score = 5;
    const reasons: string[] = [];

    // Longer content = more detail = better signal
    if (content.length > 500) { score += 1; reasons.push('Detailed post (good signal)'); }
    else if (content.length < 50) { score -= 1; reasons.push('Very short post (weak signal)'); }

    // Buyer-intent phrases
    const buyerPhrases = ['looking for', 'need a', 'need an', 'hire', 'hiring', 'budget', 'recommend', 'suggestion', 'anyone know', 'help me find', 'agency', 'freelancer', 'contractor', 'quote', 'proposal'];
    const buyerHits = buyerPhrases.filter(p => content.includes(p));
    if (buyerHits.length >= 2) { score += 2; reasons.push(`Strong buyer intent: ${buyerHits.slice(0, 3).join(', ')}`); }
    else if (buyerHits.length === 1) { score += 1; reasons.push(`Possible buyer intent: ${buyerHits[0]}`); }

    // Seller / job-seeker phrases — these should score LOW
    const sellerPhrases = ['i am a developer', 'i am a designer', 'looking for work', 'open to work', 'my portfolio', 'available for hire', 'i build', 'i create', 'dm me for', 'check out my'];
    const sellerHits = sellerPhrases.filter(p => content.includes(p));
    if (sellerHits.length > 0) { score -= 3; reasons.push(`Seller/job-seeker detected: ${sellerHits[0]}`); }

    score = Math.max(1, Math.min(10, score));

    return {
      score,
      category: 'Pending', // Let AI refine
      rationale: reasons.length > 0 ? reasons.join('. ') + '.' : 'Pending AI semantic analysis to verify buyer intent.',
      pitch: 'Hey, saw your post and wanted to connect.',
      subject: 'Regarding your recent post'
    };
  }

  if (isJobListing) {
    const content = (lead.post_content || lead.about_snippet || lead.title || '').toLowerCase();
    let score = 7; // Job listings are always buyers
    const reasons: string[] = ['Job listing — author is a buyer by definition'];

    // Budget signals
    if (content.includes('budget') || /\$\d/.test(content)) { score += 1; reasons.push('Budget mentioned'); }
    // Scope signals
    if (content.length > 300) { score += 1; reasons.push('Detailed scope'); }
    // Service fit
    const fitPhrases = ['website', 'web app', 'seo', 'landing page', 'ecommerce', 'shopify', 'wordpress', 'react', 'next.js', 'frontend', 'full stack', 'automation', 'ai', 'chatbot'];
    const fitHits = fitPhrases.filter(p => content.includes(p));
    if (fitHits.length >= 2) { score += 1; reasons.push(`Strong service fit: ${fitHits.slice(0, 3).join(', ')}`); }
    else if (fitHits.length === 0) { score -= 2; reasons.push('Weak service fit — may not match our offerings'); }

    score = Math.max(1, Math.min(10, score));
    const category = score >= 8 ? 'Diamond' : score >= 5 ? 'Gold' : 'Junk';

    return {
      score,
      category,
      rationale: reasons.join('. ') + '.',
      pitch: `Hi — saw your project listing and it aligns well with what we do. Happy to discuss scope and share relevant examples.`,
      subject: lead.title ? `Re: ${lead.title.substring(0, 60)}` : 'Regarding your project listing'
    };
  }

  let score = 5;
  const reasons: string[] = [];
  const flaws: string[] = [];

  // Check if the "website" is actually just a social media link
  const hasRealWebsite = lead.website && !isSocialMediaUrl(lead.website);
  const websiteIsSocial = lead.website && isSocialMediaUrl(lead.website);

  // ── Critical signals (Diamond territory) ──
  if (lead.is_claimed === false) {
    score += 3;
    reasons.push("Google listing is UNCLAIMED — massive vulnerability");
    flaws.push("your Google Maps listing isn't claimed yet, meaning anyone could take control of it");
  }

  if (!hasRealWebsite) {
    score += 2;
    if (websiteIsSocial) {
      const platform = detectLinkType(lead.website!);
      reasons.push(`No real website — only has ${platform} page. High-intent prospect`);
      flaws.push(`you're using ${platform} as your website, which means you're losing organic search traffic to competitors who have real sites`);
    } else {
      reasons.push("No website found — high-intent prospect");
      flaws.push("you don't have a website, so you're invisible to anyone searching online");
    }
  }

  // ── Rating signals ──
  const rating = parseFloat(lead.rating || '0');
  const reviews = parseInt(lead.reviews || '0', 10);

  if (rating > 0 && rating < 3.5) {
    score += 2;
    reasons.push(`Low rating (${rating}) — reputation needs urgent help`);
    flaws.push(`your ${rating}-star rating is hurting your credibility`);
  } else if (rating >= 3.5 && rating < 4.2) {
    score += 1;
    reasons.push(`Moderate rating (${rating}) — room for improvement`);
  } else if (rating >= 4.8 && reviews > 200) {
    score -= 2;
    reasons.push(`Excellent reputation (${rating}★, ${reviews} reviews) — harder to sell`);
  }

  if (reviews === 0) {
    score += 1;
    reasons.push("Zero reviews — fresh or neglected listing");
    flaws.push("you have no reviews on Google");
  } else if (reviews < 10) {
    score += 1;
    reasons.push(`Very few reviews (${reviews}) — needs social proof`);
  } else if (reviews > 500) {
    score -= 1;
    reasons.push(`High review count (${reviews}) — established business`);
  }

  // ── Contact signals ──
  if (!lead.phone) {
    score += 1;
    reasons.push("No phone number listed — missing basic contact");
    flaws.push("there's no phone number on your listing");
  }

  if (!lead.emails_found || lead.emails_found.length === 0) {
    reasons.push("No email found — harder to reach but less competition");
  }

  if (lead.socials && lead.socials.length === 0) {
    reasons.push("No social media presence detected");
  }

  // ── Clamp score ──
  score = Math.max(1, Math.min(10, score));

  // ── Categorize ──
  let category: string;
  if (score >= 8 || lead.is_claimed === false || !hasRealWebsite) {
    category = 'Diamond';
  } else if (score >= 5) {
    category = 'Gold';
  } else {
    category = 'Junk';
  }

  // ── Build personalized pitch ──
  const bizName = lead.name;
  const flawText = flaws.length > 0
    ? flaws.slice(0, 2).join(' and ')
    : 'a few gaps in your online presence';

  const aboutRef = lead.about_snippet
    ? `I saw ${bizName} specializes in ${lead.about_snippet.substring(0, 60).toLowerCase()}... — impressive work. `
    : '';

  const pitch = `Hi there,\n\n${aboutRef}I was doing some local market research and noticed that ${flawText}.\n\nWe've helped businesses just like yours increase their local leads by 40-60% in 30 days. I put together a quick breakdown of what we found — takes 2 minutes to review.\n\nWorth a quick look?`;

  const subjectOptions = [
    `${bizName} — spotted something on your Google listing`,
    `Quick question about ${bizName}'s online presence`,
    `${bizName}: are you losing local customers?`,
    `I found an issue with ${bizName}'s Google Maps`,
  ];

  const subject = lead.is_claimed === false
    ? `⚠️ ${bizName} — your Google listing isn't claimed`
    : !lead.website
      ? `${bizName} — you're invisible online (let's fix that)`
      : subjectOptions[Math.floor(Math.random() * subjectOptions.length)];

  return {
    score,
    category,
    rationale: reasons.join('. ') + '.',
    pitch,
    subject,
  };
}

export async function optimizeSearchQuery(
  rawInput: string,
  platform: string,
  pref: AiPref = {},
): Promise<string> {
  // If the input is already short, no need to spend a call optimizing it.
  if (rawInput.split(' ').length <= 5) {
    return rawInput;
  }

  const prompt = `
You are an expert search query optimizer for web scraping.
A user provided a long, rambling, or complex natural-language input. 
Your goal is to extract the core intent and condense it into a highly targeted 3-to-5 word search query.
This query will be sent to the search engines of platforms like Google Maps, Reddit, or Twitter.

User Input: "${rawInput}"
Target Platform: ${platform}

CRITICAL RULES:
1. ONLY output the optimized keywords. Nothing else. No quotes, no intro, no explanation.
2. Remove conversational words (e.g., "I wanna scrape for", "where is the", "what are some").
3. Keep it between 2 and 6 words maximum.
4. Focus on the core entity, niche, or topic.

Example User Input: "I am looking for dentists in austin texas that might need a new website built"
Example Output: dentists austin texas website
`;

  const res = await chatComplete(
    [{ role: 'user', content: prompt }],
    { temperature: 0.1, maxTokens: 20, ...toChatOpts(pref) },
  );
  if (!res) return rawInput;
  const optimized = res.text.trim().replace(/^["']|["']$/g, '');
  if (optimized && optimized.length > 0 && optimized.length < 100) {
    console.log(`[Query Optimizer] Optimized "${rawInput.substring(0, 30)}..." -> "${optimized}"`);
    return optimized;
  }
  return rawInput;
}

// Map the UI preference hint into chatComplete's option shape.
function toChatOpts(pref: AiPref) {
  return {
    preferProvider: pref.preferProvider,
    preferModel: pref.preferModel,
    clientKey: pref.clientKey,
    clientProvider: pref.clientProvider,
    clientModel: pref.clientModel,
  };
}


export async function scoreLead(
  lead: RawLead,
  pref: AiPref = {},
): Promise<ScoredLead> {
  // Always compute rule-based score as baseline
  const rules = ruleBasedScore(lead);

  const ruleFallback = (): ScoredLead => ({
    ...lead,
    lead_score: rules.score,
    lead_category: rules.category,
    rationale: rules.rationale,
    suggested_pitch: rules.pitch,
    suggested_subject: rules.subject,
  });

  // Truncate massively long strings so they don't break the LLM Context Window (Token Limit)
  const safeSnippet = lead.about_snippet && lead.about_snippet.length > 1000 
    ? lead.about_snippet.substring(0, 1000) + "...[TRUNCATED]" 
    : lead.about_snippet;
    
  const safeEmails = lead.emails_found && lead.emails_found.length > 5
    ? lead.emails_found.slice(0, 5)
    : lead.emails_found;

  const safeLeadData = {
    ...lead,
    about_snippet: safeSnippet,
    emails_found: safeEmails
  };

  const isSocial = lead.category === 'Social Post' || (lead.kind && lead.kind !== 'business_listing');
  const isJobListing = lead.kind === 'job';
  const postContent = lead.post_content || safeSnippet || '';
  const offer = offerOf(pref);
  let prompt = '';

  if (isJobListing) {
    // ── BRANCH 3: Job Listings (Upwork, etc.) — author is ALWAYS a buyer ──
    prompt = `
You are an elite B2B Lead Qualifier for a business that sells: ${offer}.
You are analyzing a JOB LISTING. The author is ALWAYS a buyer — never a seller. Your job is to score based on FIT WITH WHAT WE SELL, budget signals, and scope clarity.

Job Title: ${lead.title || 'N/A'}
Platform: ${lead.platform || 'upwork'}
Author: ${lead.author || lead.name}
Job Content:
${postContent}

Scoring Rules (judge fit against WHAT WE SELL: ${offer}):
- "Diamond" (Score 8-10): Clear budget mentioned ($1k+), detailed scope, strong fit with what we sell.
- "Gold" (Score 5-7): Moderate fit — the project is related but vague on budget/scope, or is a small task.
- "Junk" (Score 1-4): No fit with what we sell. Tiny budget (<$100). Unrealistic expectations.

Extract the core pain_point: What problem is the buyer trying to solve? (1 sentence)

Pitch Guidelines:
1. Write a 2-sentence proposal intro referencing their specific requirements.
2. Mention a relevant case study or metric (e.g., "We recently built a similar e-commerce platform that increased conversions by 35%.").

Output this exact JSON (no markdown, no explanation):
{"lead_score": <1-10>, "lead_category": "Diamond"|"Gold"|"Junk", "rationale": "<reason citing their requirements>", "pain_point": "<1-sentence problem they need solved>", "suggested_subject": "<proposal opener>", "suggested_pitch": "<your proposal intro>"}
`;
  } else if (isSocial) {
    // ── BRANCH 2: Social Posts — must determine BUYER vs SELLER ──
    prompt = `
You are an elite B2B Lead Qualifier. Your goal is to ruthlessly filter out junk and identify TRUE BUYERS from social media posts.
YOUR BUSINESS SELLS: ${offer}. A "buyer" is anyone who needs what we sell.

CRITICAL CHAIN-OF-THOUGHT INSTRUCTION:
Step 1: Read the post below.
Step 2: Determine — is the author a BUYER (someone who needs services) or a SELLER (someone offering services, looking for work, or self-promoting)?
Step 3: If SELLER → immediately score 1-3 (Junk). Do NOT give benefit of the doubt.
Step 4: If BUYER → score based on intent strength.

Post Author: ${lead.author || lead.name}
Post URL: ${lead.post_url || lead.website || 'N/A'}
Platform: ${lead.platform || 'unknown'}
Post Title: ${lead.title || 'N/A'}
Post Content:
${postContent}

Scoring Rules (PRECISION > RECALL — when in doubt, score LOW):

"Diamond" (Score 8-10) — REAL examples:
  - "Looking for a web developer to build our startup's MVP. Budget $5k-10k."
  - "Can anyone recommend a good SEO agency? We're getting zero organic traffic."
  - "Need to hire someone to automate our customer onboarding with AI."

"Gold" (Score 5-7) — REAL examples:
  - "My website is so slow, losing customers every day."
  - "Our Google rankings dropped after the last update, frustrated."
  - "Anyone else struggling with lead generation?"

"Junk" (Score 1-4) — REAL examples:
  - "I am a full-stack developer with 5 years experience, open to work!" → SELLER, score 1
  - "Just launched my new web design agency!" → COMPETITOR, score 1
  - "Here's a tutorial on how to build a React app" → CONTENT, score 2
  - "Check out this cool AI tool I found" → SHARING, score 3
  - "Web development is changing so fast these days" → CHATTING, score 2

Extract pain_point: What specific problem is the author facing? (1 sentence, or "none" if Junk)

Pitch Guidelines:
1. If Diamond/Gold: Write a highly personalized 2-sentence DM/reply that directly references their post content and offers a massive value-add.
2. If Junk: Set suggested_pitch to empty string.

Output this exact JSON (no markdown, no explanation):
{"lead_score": <1-10>, "lead_category": "Diamond"|"Gold"|"Junk", "rationale": "<BUYER or SELLER, then specific reason citing their text>", "pain_point": "<1-sentence problem or none>", "suggested_subject": "<short DM opener>", "suggested_pitch": "<your killer DM or empty>"}
`;
  } else {
    // ── BRANCH 1: Google Maps Business ──
    prompt = `
You are an elite B2B Lead Qualifier and Cold Email Copywriter.
Your goal is to analyze this Google Maps business and generate an incredibly personalized, high-converting cold email pitch.
YOUR BUSINESS SELLS: ${offer}. Frame every angle around how what we sell fixes this business's gaps.
(If we sell web/SEO/AI, lean on the digital-presence gaps below; if we sell something else, use those gaps as openers, then pivot to our offer.)

Business Data:
${JSON.stringify(safeLeadData, null, 2)}

Scoring Rules:
- "Diamond" (Score 8-10): is_claimed=false, OR no website, OR rating < 3.5. These are massive vulnerabilities.
- "Gold" (Score 5-7): Has website but poor reviews/presence, or missing phone number.
- "Junk" (Score 1-4): 4.5+ rating, 100+ reviews, strong online presence.

Pitch Guidelines (CRITICAL):
1. NO GENERIC FLUFF. Never say "I noticed areas for improvement."
2. POKE THE PAIN POINT DIRECTLY AND PITCH THE FUTURE.
   - If 'is_claimed' is false: Warn them anyone could hijack their Maps listing today. Offer a free 2-min video on how to lock it down and optimize it for AI search engines (GEO/LLMO).
   - If no website / uses social media as website: Warn them they are invisible to ChatGPT, Perplexity, and Google's AI Overviews. Offer to spin up an AEO-optimized site in 3 days.
   - If rating < 4.0 or few reviews: Tell them low trust means AI engines won't recommend them. Offer an automated 5-star review system.
3. Keep it to 2-3 sentences max. Conversational, punchy, aggressive but professional.

Output this exact JSON structure (no markdown, no explanation):
{"lead_score": <1-10>, "lead_category": "Diamond"|"Gold"|"Junk", "rationale": "<specific reason>", "suggested_subject": "<catchy, informal email subject>", "suggested_pitch": "<your killer cold email>"}
`;
  }

  const res = await chatComplete(
    [{ role: 'user', content: prompt }],
    { temperature: 0.2, maxTokens: 300, ...toChatOpts(pref) },
  );
  // No key available or every key failed → rule-based baseline.
  if (!res) return ruleFallback();

  let scored: ScoredLead;
  try {
    // Robust JSON extraction: find the first { and last }.
    const jsonMatch = res.text.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const parsed = JSON.parse(jsonString);

    scored = {
      ...lead,
      lead_score: typeof parsed.lead_score === 'number' ? parsed.lead_score : rules.score,
      lead_category: parsed.lead_category || rules.category,
      rationale: parsed.rationale || rules.rationale,
      suggested_pitch: parsed.suggested_pitch ?? rules.pitch,
      suggested_subject: parsed.suggested_subject || rules.subject,
      ...(parsed.pain_point ? { pain_point: parsed.pain_point } : {}),
    };
  } catch (error: any) {
    console.error("[AI] JSON parse failed — falling back to rule-based:", error.message);
    return ruleFallback();
  }

  // Cross-provider verification: a SECOND brain (a different provider) checks the
  // first on promising leads, so Groq/NIM/Gemini correct each other for accuracy.
  return crossCheckScore(lead, scored, res.provider, pref);
}

/**
 * Second-opinion pass. A different provider re-grades a promising lead and can
 * correct the score/category; results are reconciled (conservative on downgrade).
 * Skipped when disabled, for weak leads, or when only one provider is available.
 */
async function crossCheckScore(
  lead: RawLead,
  primary: ScoredLead,
  primaryProvider: AiProvider | undefined,
  pref: AiPref,
): Promise<ScoredLead> {
  if (process.env.AI_CONSENSUS === '0') return primary;
  // Double-check everything except obvious junk. Catches under-scored good leads
  // (false negatives) as well as over-scored ones. Floor is tunable.
  const minScore = parseInt(process.env.AI_CONSENSUS_MIN || '4', 10);
  if ((primary.lead_score ?? 0) < minScore) return primary;
  const providers = availableProviders();
  if (providers.length < 2) return primary;                   // need a genuine second brain
  const other = providers.find(p => p !== primaryProvider);

  const content = (lead.post_content || lead.about_snippet || lead.title || lead.name || '').slice(0, 500);
  const verifyPrompt = `You are a strict QA reviewer auditing another AI's lead score for accuracy.

LEAD: ${lead.name}${lead.platform ? ` [${lead.platform}]` : ''}
CONTENT: ${content}
WEBSITE: ${lead.website || 'none'} | EMAIL: ${(lead.emails_found || [])[0] || 'none'}

ANOTHER AI SCORED IT: ${primary.lead_score}/10 (${primary.lead_category}) — "${primary.rationale}"

Is that accurate? A real buyer-intent / high-fit lead deserves 7-10; a weak or off-topic one deserves 1-4. Reply with ONLY this JSON:
{"agree": true|false, "lead_score": <1-10>, "lead_category": "Diamond"|"Gold"|"Junk", "correction": "<≤12 words, only if you disagree>"}`;

  const vr = await chatComplete(
    [{ role: 'user', content: verifyPrompt }],
    { temperature: 0, maxTokens: 160, ...toChatOpts(pref), preferProvider: other },
  );
  if (!vr) return primary;

  try {
    const p = JSON.parse((vr.text.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    const secondScore = typeof p.lead_score === 'number' ? p.lead_score : primary.lead_score;
    if (p.agree === false && Math.abs(secondScore - (primary.lead_score ?? 0)) >= 1) {
      // Reconcile: average the two brains; on a downgrade keep the lower category.
      const merged = Math.max(1, Math.min(10, Math.round(((primary.lead_score ?? 0) + secondScore) / 2)));
      const downgraded = secondScore < (primary.lead_score ?? 0);
      return {
        ...primary,
        lead_score: merged,
        lead_category: downgraded ? (p.lead_category || primary.lead_category) : primary.lead_category,
        rationale: `${primary.rationale} · ${primaryProvider}↔${vr.provider} cross-check${p.correction ? `: ${p.correction}` : ''}`,
      };
    }
    // Agreement → mark it as verified so the user knows two brains concur.
    return { ...primary, rationale: `${primary.rationale} · verified by ${vr.provider}` };
  } catch {
    return primary;
  }
}

export interface IntentOption {
  platform: string;
  label: string;
  niche?: string;
  location?: string;
  keyword?: string;
  /** Recommended recency window: 'h'|'d'|'w'|'m'|'any'. Fresh asks age fast. */
  freshness?: string;
}

const VALID_FRESHNESS = new Set(['h', 'd', 'w', 'm', 'y', 'any']);

export async function analyzeIntent(
  intent: string,
  platforms: string[] = [],
  niche?: string,
  location?: string,
  pref: AiPref = {},
): Promise<IntentOption[]> {
  const allLocation = ["gmaps"];
  const allSocial = ["reddit", "x", "linkedin", "facebook", "instagram", "hackernews", "devto", "darkweb"];
  const allQa = ["stackoverflow", "quora", "producthunt", "upwork", "indiamart", "justdial"];

  const loc = allLocation.filter(p => !platforms.length || platforms.includes(p));
  const soc = allSocial.filter(p => !platforms.length || platforms.includes(p));
  const qa = allQa.filter(p => !platforms.length || platforms.includes(p));

  let platformsStr = "Available platforms:\n";
  if (loc.length) platformsStr += `- Location-based: ${loc.map(p => `"${p}"`).join(', ')}\n`;
  if (soc.length) platformsStr += `- Social & Forums: ${soc.map(p => `"${p}"`).join(', ')}\n`;
  if (qa.length) platformsStr += `- Q&A & Jobs: ${qa.map(p => `"${p}"`).join(', ')}\n`;

  let constraintsStr = "";
  if (platforms && platforms.length > 0) constraintsStr += `CRITICAL CONSTRAINT: You MUST restrict your output ONLY to the platforms listed above. Do not suggest anything else.\n`;
  if (niche) constraintsStr += `CRITICAL CONSTRAINT: The user explicitly wants this Business Category/Niche: "${niche}". Ensure your gmaps options use this exact niche.\n`;
  if (location) constraintsStr += `CRITICAL CONSTRAINT: The user explicitly wants this Target Location: "${location}". Ensure your gmaps options use this exact location.\n`;

  const offer = offerOf(pref);
  const prompt = `
You are an elite B2B Lead-Generation Strategist. A user pasted a natural-language "dump" of the leads they want. Convert it into a JSON array of sharp, ready-to-run scraping options, ordered highest-intent first.

WHAT THE USER SELLS (their offer): ${offer}
Every option must target BUYERS of this offer — people/businesses who need what the user sells. Do NOT assume they sell websites unless the offer says so.

User Intent: "${intent}"

${platformsStr}
${constraintsStr}

HOW EACH PLATFORM FINDS LEADS (choose the right tool for the intent):
- "gmaps": local/physical businesses by category + place. Needs "niche" + "location". Best when the user wants businesses to SELL TO (e.g. dentists, restaurants, plumbers).
- "linkedin": companies & decision-makers (founders/CEOs/owners). Good for B2B service buyers.
- "reddit" / "x" / "quora": people publicly ASKING for help, recommendations, or venting a pain point. Best for buyer-intent posts/questions.
- "justdial" / "indiamart": Indian B2B directory listings of local businesses/suppliers.
- "upwork": job listings where the author is ALWAYS a buyer.
- "hackernews" / "devto" / "stackoverflow" / "producthunt": technical/startup audiences.

KEYWORD RULES (this is what makes or breaks lead quality):
1. Keep "keyword" SHORT (2-5 words) — it becomes a search dork, so buyer-intent phrasing is added automatically downstream. Do NOT stuff it with quotes or operators.
2. Use the core niche/service + the buyer's angle, not filler. Bad: "people who might want marketing". Good: "digital marketing agency".
3. For gmaps, "niche" is the business category and "location" is the city/region — both concise.
4. Prefer the SERVICE the user sells as the anchor (e.g. if they sell websites, target businesses that need websites).

FRESHNESS (critical for buyer-intent posts — a comment 2 hours old converts, one 5 days old is already taken):
- Add a "freshness" field to EACH option: one of "h" (past hour), "d" (past 24h), "w" (past week), "m" (past month), "any".
- Social/forum asks (reddit, x, quora, facebook, instagram, upwork) age FAST → prefer "d" (or "h" if the user wants only the hottest).
- Directory/business listings (gmaps, indiamart, justdial, linkedin company pages) don't decay → use "m" or "any".

OUTPUT RULES:
1. Generate 3-6 distinct, non-overlapping options. Spread across platforms when the intent supports it; don't duplicate the same query on one platform.
2. If a physical/local business type or place is mentioned, ALWAYS include a "gmaps" option.
3. Respect every CRITICAL CONSTRAINT above exactly. If platforms were restricted, use ONLY those.
4. Every option needs a "label" (short human description) and a "freshness". gmaps needs "niche"+"location"; all others need "keyword".
5. Order the array by expected lead quality (strongest buyer-intent first).

Output MUST be raw JSON only (no markdown fences, no commentary):
[
  { "platform": "reddit", "label": "Reddit: businesses needing a roofer (fresh)", "keyword": "roof leak recommendation", "freshness": "d" },
  { "platform": "gmaps", "label": "Google Maps: Roofing companies in Texas", "niche": "roofing companies", "location": "Texas", "freshness": "any" },
  { "platform": "linkedin", "label": "LinkedIn: roofing business owners", "keyword": "roofing company owner", "freshness": "m" }
]
`;

  const res = await chatComplete(
    [{ role: 'user', content: prompt }],
    { temperature: 0.2, maxTokens: 500, ...toChatOpts(pref) },
  );
  if (!res) {
    throw new Error('No working AI key available. Add a Groq or NIM key in Settings → AI Key Pool (or .env.local).');
  }
  let raw: any[];
  try {
    const jsonMatch = res.text.match(/\[[\s\S]*\]/);
    raw = JSON.parse(jsonMatch ? jsonMatch[0] : '[]');
    if (!Array.isArray(raw)) throw new Error('not an array');
  } catch (error: any) {
    console.error("[Intent Analyzer] JSON parse failed:", error.message);
    throw new Error('AI returned an unparseable response. Try again.');
  }

  // Validate + normalise so we never hand the scraper a malformed option.
  const allowed = new Set([...allLocation, ...allSocial, ...allQa]);
  const constrained = platforms && platforms.length > 0;
  const seen = new Set<string>();
  const options: IntentOption[] = [];

  // Sensible per-family default when the model omits/garbles freshness.
  const defaultFreshness = (p: string): string =>
    (['gmaps', 'indiamart', 'justdial', 'linkedin'].includes(p) ? 'm' : 'd');

  for (const o of raw) {
    if (!o || typeof o !== 'object') continue;
    const platform = String(o.platform || '').toLowerCase().trim();
    if (!allowed.has(platform)) continue;                 // unknown platform → drop
    if (constrained && !platforms.includes(platform)) continue; // honour the constraint

    const fRaw = String(o.freshness || '').toLowerCase().trim();
    const freshness = VALID_FRESHNESS.has(fRaw) ? fRaw : defaultFreshness(platform);

    if (platform === 'gmaps') {
      const n = (o.niche || niche || '').toString().trim();
      const l = (o.location || location || '').toString().trim();
      if (!n || !l) continue;                             // gmaps needs both
      const key = `gmaps|${n}|${l}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ platform, label: (o.label || `Google Maps: ${n} in ${l}`).toString(), niche: n, location: l, freshness });
    } else {
      const kw = (o.keyword || '').toString().trim();
      if (!kw) continue;                                  // social/Q&A needs a keyword
      const key = `${platform}|${kw}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ platform, label: (o.label || `${platform}: ${kw}`).toString(), keyword: kw, freshness });
    }
  }

  if (options.length === 0) {
    throw new Error('No valid scraping options could be built from that intent. Try describing the niche and location more concretely.');
  }
  return options;
}
