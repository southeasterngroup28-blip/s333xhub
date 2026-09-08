// The chat's surfaces over the photo background.
//
// Letter's bubbles started out see-through with only a hairline, which was
// hard to read on device. A fully solid pass went too far ("all the way
// solid"). These are the middle: charcoal with enough body to read on any
// frame of the photo, and enough give that the photo still breathes
// through it. Change them here, not in the screens.
export const CHAT_SURFACE = 'rgba(14,16,20,0.74)'; // everyone else's bubbles, media tiles, pills, chips
export const CHAT_SURFACE_MINE = 'rgba(37,40,46,0.86)'; // my bubbles: one shade up, a touch firmer
export const CHAT_SURFACE_ROW = 'rgba(14,16,20,0.76)'; // chat list cards
export const CHAT_COMPOSER = 'rgba(8,9,12,0.9)'; // the pill you type into: firmest, it's a control
export const CHAT_HAIRLINE = 'rgba(255,255,255,0.16)';
export const CHAT_HAIRLINE_MINE = 'rgba(255,255,255,0.08)';
