/**
 * LaunchPixel Ideal Customer Profile (ICP) — the single source of truth the AI
 * scorer references so every lead is judged against what LaunchPixel actually
 * sells, not a generic "digital agency" template.
 *
 * Mirrors python_engine/scrapers/icp.py. Keep the two in rough sync.
 *
 * LaunchPixel (launchpixel.in): a full-stack digital agency — web development &
 * systems, UI/UX + motion, brand strategy & identity, SEO / performance
 * marketing, e-commerce, mobile apps, and AI automation. Serves ambitious
 * brands in e-commerce, EdTech, agri, travel/booking, SaaS, and education.
 * India-based, remote worldwide, premium positioning.
 */

export const LAUNCHPIXEL = {
  name: 'LaunchPixel',
  site: 'launchpixel.in',
  positioning:
    'a premium full-stack digital agency that builds world-class digital ecosystems (design + engineering + marketing in one team)',
  services: [
    'Web development & custom web systems',
    'UI/UX design & motion',
    'Brand strategy & visual identity',
    'SEO & performance marketing',
    'E-commerce (Shopify / WooCommerce / custom)',
    'Mobile apps (iOS/Android) & MVPs',
    'AI automation (chatbots, workflow automation)',
  ],
  industries: [
    'E-commerce / D2C',
    'EdTech & education',
    'SaaS & startups',
    'Agriculture / agri-tech',
    'Travel, booking & hospitality',
  ],
} as const;

/** Compact, promptable description of who LaunchPixel is and what it sells. */
export const ICP_BRIEF = `You work for ${LAUNCHPIXEL.name} (${LAUNCHPIXEL.site}), ${LAUNCHPIXEL.positioning}.
Services offered: ${LAUNCHPIXEL.services.join('; ')}.
Best-fit industries: ${LAUNCHPIXEL.industries.join('; ')}.
A GREAT lead has a concrete need that maps to one of these services and the authority/budget to buy. A POOR lead is another agency/freelancer selling these same services, a job-seeker, or someone with no service-mappable need.`;

/** Service tags the AI is asked to attach to a lead, for CRM filtering. */
export const SERVICE_FIT_TAGS = [
  'web-development',
  'ecommerce',
  'branding',
  'seo-marketing',
  'mobile-app',
  'ai-automation',
  'none',
] as const;
