// Public web pages (the s333xgod repo, served by GitHub Pages at the
// company's own subdomain). Auth emails redirect here, and App Store
// Connect points at the legal pages.
//
// Before a build with this URL ships: the Porkbun CNAME `app` must point
// at southeasterngroup28-blip.github.io, the repo's Pages settings must
// name app.s333xhub.com (the CNAME file in the repo), and Supabase Auth >
// URL Configuration must allow https://app.s333xhub.com/** or the confirm
// and reset emails land on a refused redirect.
export const PUBLIC_SITE_URL = 'https://app.s333xhub.com';

export const CONFIRM_EMAIL_URL = `${PUBLIC_SITE_URL}/confirm-email.html`;
export const RESET_PAGE_URL = `${PUBLIC_SITE_URL}/reset-password.html`;
export const PRIVACY_URL = `${PUBLIC_SITE_URL}/privacy.html`;
export const TERMS_URL = `${PUBLIC_SITE_URL}/terms.html`;
