// The source strings. Every other locale has exactly these keys and placeholders.
export const en = {
  picker: {
    title: 'Choose your language',
    mascot: "Bok! I'm Fetivi. Which language should we talk in?",
    yourLanguage: "Your phone's language",
  },
  pin: {
    title: 'Enter your PIN',
    hint: 'Your host sent you a six-digit PIN.',
    label: 'PIN',
    submit: 'Continue',
    wrong: "That PIN doesn't match. Check your host's message and try again.",
    wait: 'Too many tries. You can try again in {{time}}.',
    changeLanguage: 'Change language',
  },
  link: {
    notFound: "This link doesn't work. Scan the QR code in the apartment again.",
    none: 'Open the link your host sent you, or scan the QR code in the apartment.',
  },
  header: {
    language: 'Language',
    chooseLanguage: 'Choose a language',
  },
  tabs: {
    label: 'Sections',
    chat: 'Chat',
    guide: 'Guide',
    trip: 'My trip',
    unread: '{{count}} unread',
  },
  empty: {
    chat: "This is where we'll chat. I'll be here soon.",
    guide: 'Your guide to the apartment and the area will appear here.',
    trip: 'Your trip plans will appear here.',
  },
  common: {
    close: 'Close',
    loading: 'Loading…',
  },
  error: {
    network: 'No connection. Check your internet and try again.',
  },
} as const;

/** The shape every locale fills, with plain strings. */
export type Messages = { [S in keyof typeof en]: { [K in keyof (typeof en)[S]]: string } };
