export interface RawLead {
  id: string;
  name: string;
  rating?: string;
  reviews?: string;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  emails_found?: string[];
  website_snippet?: string;
  is_claimed?: boolean;
  socials?: string[];
  about_snippet?: string;
  // Social / multi-platform fields
  platform?: string;      // 'gmaps' | 'reddit' | 'x' | 'linkedin' | 'hackernews' | 'devto' | 'stackoverflow' | 'instagram' | 'producthunt' | 'quora' | 'upwork'
  kind?: string;          // 'business_listing' | 'post' | 'comment' | 'job'
  author?: string;
  author_url?: string;
  post_url?: string;
  post_content?: string;
  title?: string;
  matched_keyword?: string;
  posted_at?: string;
  external_id?: string;
}

export interface ScoredLead extends RawLead {
  lead_score: number; // 1-10
  lead_category: string; // 'Diamond' | 'Gold' | 'Junk' | 'Uncategorized'
  rationale: string;
  suggested_pitch: string;
  suggested_subject?: string;
  pain_point?: string;
  status?: string; // 'Uncontacted' | 'Emailed' | 'Replied' | 'Closed'
}
