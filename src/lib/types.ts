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
}

export interface ScoredLead extends RawLead {
  lead_score: number; // 1-10
  lead_category: string; // 'Diamond' | 'Gold' | 'Junk' | 'Uncategorized'
  rationale: string;
  suggested_pitch: string;
  suggested_subject?: string;
  status?: string; // 'Uncontacted' | 'Emailed' | 'Replied' | 'Closed'
}
