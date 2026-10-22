import type { GuestCopy } from './types';

export const en: GuestCopy = {
  dateFormat: 'EEE d MMM',
  dateAtTime: '{{date}} at {{time}}',
  kinds: {
    order_confirmed: {
      subject: 'Confirmed: {{offer}}, {{date}}',
      lines: [
        'Good news: {{offer}} on {{date}} is confirmed.',
        'You can see the details in My trip.',
      ],
      pushTitle: 'Confirmed',
      pushBody: '{{offer}}, {{date}}',
    },
    order_new_proposal: {
      subject: 'A new time or price for {{offer}}',
      lines: [
        'The provider of {{offer}} suggested a different time or price.',
        'Open My trip to accept it or say no.',
      ],
      pushTitle: 'New suggestion',
      pushBody: '{{offer}}: please take a look',
    },
    order_cancelled: {
      subject: 'Cancelled: {{offer}}, {{date}}',
      lines: ['{{offer}} on {{date}} has been cancelled.', 'You can see the details in My trip.'],
      pushTitle: 'Cancelled',
      pushBody: '{{offer}}, {{date}}',
    },
    order_declined: {
      subject: 'Not available: {{offer}}, {{date}}',
      lines: [
        "Sorry, the provider can't take your booking for {{offer}} on {{date}}.",
        'You can ask me for something else in the chat.',
      ],
      pushTitle: 'Not available',
      pushBody: '{{offer}}, {{date}}',
    },
    order_expired: {
      subject: 'No answer in time: {{offer}}, {{date}}',
      lines: [
        "The provider didn't answer in time, so your request for {{offer}} on {{date}} has closed.",
        'You can ask me for something else in the chat.',
      ],
      pushTitle: 'Request closed',
      pushBody: '{{offer}}, {{date}}',
    },
    order_failed: {
      subject: "Couldn't book: {{offer}}, {{date}}",
      lines: [
        "Something went wrong and {{offer}} on {{date}} couldn't be booked.",
        'You can try again or ask me in the chat.',
      ],
      pushTitle: "Couldn't book",
      pushBody: '{{offer}}, {{date}}',
    },
    order_reminder: {
      subject: 'Tomorrow: {{offer}}',
      lines: ['A reminder: {{offer}} is tomorrow, {{date}}.', 'The details are in My trip.'],
      pushTitle: 'Tomorrow',
      pushBody: '{{offer}}, {{date}}',
    },
    host_reply: {
      subject: 'Your host replied',
      lines: ['Your host replied to your message.', 'Open the chat to read it.'],
      pushTitle: 'Your host replied',
      pushBody: 'Open the chat to read it.',
    },
    arrival_details: {
      subject: 'Your arrival details are ready',
      lines: [
        'Your arrival details are ready in the Guide: how to get in, Wi-Fi and the rest.',
        'Have a good trip.',
      ],
      pushTitle: 'Arrival details are ready',
      pushBody: 'Open the Guide to see how to get in.',
    },
    checkout_reminder: {
      subject: 'Checkout is tomorrow',
      lines: ['A reminder that checkout is tomorrow.'],
      pushTitle: 'Checkout is tomorrow',
      pushBody: 'The checkout steps are in the Guide.',
    },
    weather_warning: {
      subject: 'Weather warning from DHMZ ({{level}})',
      lines: [
        'DHMZ, the Croatian weather service, has issued a weather warning ({{level}}) for {{area}}, {{time}}:',
        '"{{event}}. {{description}}"',
      ],
      pushTitle: 'DHMZ weather warning ({{level}})',
      pushBody: '{{event}}, {{time}}',
    },
    ferry_disruption: {
      subject: 'Jadrolinija notice about line {{lines}}',
      lines: [
        'Jadrolinija\'s notice says: "{{bulletinTitle}}"',
        'It may affect {{offer}} on {{date}} (line {{lines}}). Please read the notice before you go: {{bulletinUrl}}',
      ],
      pushTitle: 'Jadrolinija notice: line {{lines}}',
      pushBody: '{{offer}}, {{date}}',
    },
    daily_tip: {
      subject: 'A tip for tomorrow: {{offer}}',
      // The rule's own lines (tipRules) are used instead.
      lines: [],
      pushTitle: 'A tip for tomorrow',
      pushBody: '{{offer}}',
    },
  },
  warningLevels: { yellow: 'yellow', orange: 'orange', red: 'red' },
  warningTime: '{{from}} – {{to}}',
  sailingAdvisory:
    'Sea conditions may disrupt sailings on line {{lines}} ({{offer}}, {{date}}). Check with {{operator}} before you go: {{operatorUrl}}',
  orderStands:
    "Your booking stays as it is unless the provider cancels it. If they do, I'll tell you straight away.",
  sourceLine: 'Source: {{source}}, {{sourceUrl}}',
  checkoutTimeLine: 'Please leave by {{checkoutTime}}.',
  reviewLine: "If you'd like to share how your stay went, you can leave a review on {{platform}}.",
  tipRules: {
    rain: [
      'It looks like rain tomorrow, {{date}}.',
      '{{offer}} is a good place to spend it{{distance}}.',
    ],
    event: ['Since you like this kind of thing: {{offer}} is on tomorrow, {{date}}{{venue}}.'],
    gap: [
      'Tomorrow, {{date}}, is still free in your plan.',
      "How about {{offer}}{{distance}}? Ask me and I'll tell you more.",
    ],
  },
  tipDistance: ' ({{km}} km away)',
  tipVenue: ', at {{venueName}}',
  tipUnsubscribe: 'You get one tip a day because you asked for it. Stop these tips with one click:',
  spaceEmails: {
    verify_email: {
      subject: 'Confirm your email for Fetivi',
      lines: [
        'Please confirm this is your email. Then I can send you updates about your stay here, like replies from your host.',
        'The link works for 24 hours.',
      ],
      action: 'Confirm my email',
    },
    recover: {
      subject: 'Your link back to Fetivi',
      lines: [
        'Here is your link to open your Fetivi on this or another device, with your chat and bookings.',
        "It works once, for 1 hour. If you didn't ask for it, you can ignore this email.",
      ],
      action: 'Open my Fetivi',
    },
  },
  openApp: 'Open Fetivi',
  signature: 'Fetivi',
};
