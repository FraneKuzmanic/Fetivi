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
  chat: {
    title: 'Chat',
    welcome:
      "Bok! I'm Fetivi, an AI assistant for your stay. Ask me about the apartment, like the Wi-Fi, check-in, house rules or how things work, and about the area around you. If I don't know something, I can ask your host for you.",
    you: 'You',
    fetivi: 'Fetivi',
    typing: 'Fetivi is typing…',
    inputLabel: 'Message Fetivi',
    placeholder: 'Ask me anything about your stay',
    send: 'Send',
    closed: 'Your stay has ended. You can still read this chat.',
    startersLabel: 'Ideas to start with',
    starterWifi: "What's the Wi-Fi password?",
    starterTimes: 'When are check-in and checkout?',
    starterAccess: 'How do I get in?',
    starterRules: 'What are the house rules?',
    starterAround: "What's good to do around here?",
    tripTitle: 'Tell me about your trip',
    tripBody: "Who's travelling and what do you enjoy? I'll keep it in mind. You can skip this.",
    tripStart: "Let's go",
    tripSkip: 'Skip',
    tripMessage: 'Let me tell you about our trip.',
    errorTurn: 'Something went wrong. Try again.',
    errorBusy: "I'm still answering your last message.",
    errorClosed: 'Your stay has ended, so the chat is read-only now.',
    retry: 'Try again',
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
