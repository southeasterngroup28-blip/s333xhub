// Apple requires user-generated-content apps to filter objectionable
// material. This is a simple word-mask: flagged words become asterisks
// before the message is ever stored. Extend the list any time.
const BLOCKED_WORDS = [
  'fuck',
  'fucking',
  'fucker',
  'motherfucker',
  'shit',
  'bullshit',
  'bitch',
  'asshole',
  'cunt',
  'dick',
  'pussy',
  'slut',
  'whore',
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'retard',
  'kike',
  'spic',
  'chink',
  'wetback',
  'tranny',
];

const pattern = new RegExp(`\\b(${BLOCKED_WORDS.join('|')})\\b`, 'gi');

/** Replaces each blocked word with asterisks of the same length. */
export function cleanMessage(text: string): string {
  return text.replace(pattern, (match) => '*'.repeat(match.length));
}
