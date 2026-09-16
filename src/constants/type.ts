import type { TextStyle, ViewStyle } from 'react-native';

// The app's display face. Every block-lettered title reads this one
// constant, so trying a new font is a one-line change here.
//
// Loaded options (all registered in app/_layout.tsx):
//   'Anton_400Regular'      heavy poster block (the original, artist-approved)
//   'SixCaps_400Regular'    tall, towering, editorial
//   'Butcherman_400Regular' slashed punk scrawl (tried 2026-09-01, rejected)
export const DISPLAY_FONT = 'Anton_400Regular';

// ---- small type, defined once ----------------------------------------
// Plain style objects, spread into each screen's StyleSheet. Anton never
// goes below 12px; the sans tokens below cover every small label.

/** Section captions and form field labels: UPCOMING, PRICE ($), MY TICKETS. */
export const capLabel: TextStyle = {
  color: '#6d7076',
  fontSize: 10.5,
  fontWeight: '700',
  letterSpacing: 1.6,
};

/** The same caption in ghost silver, for a live count or a scan idle line. */
export const capLabelAccent: TextStyle = { ...capLabel, color: '#c3cdd6' };

/** The shop card's top line: DROP 001 · LIVE NOW. */
export const kicker: TextStyle = {
  color: '#8f99a3',
  fontSize: 10,
  fontWeight: '700',
  letterSpacing: 1.6,
};

/** Tiny silver line above a name or a date: TONIGHT, THE ARTIST, COMMUNITY · 128. */
export const eyebrow: TextStyle = {
  color: '#c3cdd6',
  fontSize: 9.5,
  fontWeight: '700',
  letterSpacing: 1.4,
};

/** The ticket detail card's eyebrow only. */
export const eyebrowLg: TextStyle = { ...eyebrow, fontSize: 10, letterSpacing: 1.6 };

/** "N LEFT" on the shop card and the drop page (colour set at the site). */
export const stockLeft: TextStyle = {
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 1.2,
};

/** Anton head that introduces a list: TOP 3, THE REGISTRY, SENT, PICK YOUR NUMBER. */
export const sectionHead: TextStyle = {
  fontFamily: DISPLAY_FONT,
  fontSize: 15,
  letterSpacing: 2,
  color: '#f4f5f6',
};

/** A centred tab-root or pushed-screen title at its larger size. */
export const pageTitle: TextStyle = {
  color: '#f4f5f6',
  fontSize: 22,
  fontFamily: DISPLAY_FONT,
  letterSpacing: 2,
};

/** Every non-tab screen's header title (PushedHeader). */
export const pushedTitle: TextStyle = {
  color: '#fff',
  fontSize: 17,
  fontFamily: DISPLAY_FONT,
  letterSpacing: 2,
};

/** The label inside a primary white pill: BUY, POST SHOW, SEND TO THE ARTIST. */
export const pillText: TextStyle = {
  color: '#0b0c0e',
  fontWeight: '800',
  fontSize: 13,
  letterSpacing: 1,
};

// ---- the inline confirm --------------------------------------------
// One question, one go word, one Cancel, in two containers: a chip row
// (feed, drop, show form, reports, settings) or the channel's floating pill.

/** The question: "Delete this post for everyone?" */
export const confirmQuestion: TextStyle = { color: '#9a9ba3', fontSize: 13 };
/** The go word and Cancel, sentence case. */
export const confirmWord: TextStyle = { color: '#fff', fontSize: 13, fontWeight: '600' };
/** The go word when it destroys something. */
export const confirmDanger: TextStyle = { ...confirmWord, color: '#f87171' };
/** The chip a confirm word sits in (post-card's). */
export const chip: ViewStyle = {
  backgroundColor: '#1e2126',
  borderRadius: 999,
  paddingHorizontal: 12,
  paddingVertical: 6,
};
