import OpenAI from 'openai';
import { RawLead, ScoredLead } from './types';

const MODEL = 'meta/llama-3.1-8b-instruct';

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

export async function scoreLead(
  lead: RawLead,
  apiKey?: string,
  provider: 'nim' | 'openai' | 'gemini' = 'nim',
  model: string = 'meta/llama-3.1-8b-instruct'
): Promise<ScoredLead> {
  // Always compute rule-based score as baseline
  const rules = ruleBasedScore(lead);

  if (!apiKey) {
    return {
      ...lead,
      lead_score: rules.score,
      lead_category: rules.category,
      rationale: rules.rationale,
      suggested_pitch: rules.pitch,
      suggested_subject: rules.subject,
    };
  }

  // If AI enhancement is requested but API key is missing, fail gracefully.
  if (!apiKey) {
    console.warn(`[AI Engine] Missing API Key for provider: ${provider}. Falling back to rule-based engine.`);
    return {
      ...lead,
      lead_score: rules.score,
      lead_category: rules.category,
      rationale: rules.rationale,
      suggested_pitch: rules.pitch,
      suggested_subject: rules.subject,
    };
  }

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

  let clientOptions: any = { apiKey };
  
  if (provider === 'nim') {
    clientOptions.baseURL = 'https://integrate.api.nvidia.com/v1';
  } else if (provider === 'gemini') {
    clientOptions.baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
  }
  // For openai, it uses default base URL

  const openai = new OpenAI(clientOptions);

  const prompt = `
You are an elite B2B Lead Qualifier and Cold Email Copywriter for a high-end digital marketing agency.
Your goal is to analyze this Google Maps business and generate an incredibly personalized, high-converting cold email pitch.
Your agency specializes in cutting-edge growth: Web Dev, SEO, AEO (Answer Engine Optimization), GEO (Generative Engine Optimization), and LLMO (LLM Optimization).

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

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content || '{}';
    
    // Robust JSON extraction: Find the first { and last }
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    
    const parsed = JSON.parse(jsonString);

    return {
      ...lead,
      lead_score: parsed.lead_score || rules.score,
      lead_category: parsed.lead_category || rules.category,
      rationale: parsed.rationale || rules.rationale,
      suggested_pitch: parsed.suggested_pitch || rules.pitch,
      suggested_subject: parsed.suggested_subject || rules.subject,
    };
  } catch (error: any) {
    console.error("AI Error:", error.message, "— falling back to rule-based scoring");
    // Fallback to rule-based scoring (already computed)
    return {
      ...lead,
      lead_score: rules.score,
      lead_category: rules.category,
      rationale: rules.rationale,
      suggested_pitch: rules.pitch,
      suggested_subject: rules.subject,
    };
  }
}
