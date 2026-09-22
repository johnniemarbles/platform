/**
 * GTM UX-B — static starter packs for operator takeoff.
 * Pure definitions. No DB. No send. No auto-publish.
 */

export interface GtmStarterPackDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly icp: {
    readonly name: string;
    readonly industries: readonly string[];
    readonly geographies: readonly string[];
    readonly companySizeHints: readonly string[];
    readonly titleHints: readonly string[];
    readonly seniorityHints: readonly string[];
    readonly disqualifiers: readonly string[];
  };
  readonly sequence: {
    readonly name: string;
    readonly touches: readonly {
      readonly subject: string;
      readonly body: string;
      readonly delayDays: number;
    }[];
  };
}

export const GTM_STARTER_PACKS: readonly GtmStarterPackDefinition[] = [
  {
    key: 'ops_saas_b2b',
    label: 'B2B SaaS — Ops / RevOps',
    description: 'Reach operations and revenue leaders at mid-market software companies.',
    icp: {
      name: 'Ops & RevOps leaders (SaaS)',
      industries: ['software', 'saas'],
      geographies: ['US', 'UK', 'EU', 'global'],
      companySizeHints: ['51-200', '201-1000', 'mid-market'],
      titleHints: ['Head of Operations', 'VP Operations', 'RevOps', 'COO', 'Director of Ops'],
      seniorityHints: ['director', 'vp', 'c-level'],
      disqualifiers: ['student', 'intern', 'unemployed'],
    },
    sequence: {
      name: 'Ops outreach — 3 touches',
      touches: [
        {
          delayDays: 0,
          subject: '{{company}} — quick idea for your ops stack',
          body: 'Hi {{firstName}},\n\nI work with ops leaders at {{company}}-scale teams on reducing handoffs between systems.\n\nWould a 15-minute look at how peers cut manual follow-up be useful?\n\n{{senderName}}\n{{senderTitle}}',
        },
        {
          delayDays: 3,
          subject: 'Re: {{company}} ops follow-up',
          body: 'Hi {{firstName}},\n\nSharing one concrete pattern: a single playbook for outreach → handoff so nothing stalls after a positive reply.\n\nHappy to send a one-pager if useful.\n\n{{senderName}}',
        },
        {
          delayDays: 5,
          subject: 'Close the loop?',
          body: 'Hi {{firstName}},\n\nNo worries if timing is off. If ops follow-up is on the roadmap later, I am easy to reach.\n\n{{senderName}}',
        },
      ],
    },
  },
  {
    key: 'agency_owners',
    label: 'Agency owners',
    description: 'Reach founders and managing partners at digital / creative agencies.',
    icp: {
      name: 'Agency founders & partners',
      industries: ['marketing', 'advertising', 'agency'],
      geographies: ['US', 'UK', 'global'],
      companySizeHints: ['11-50', '51-200'],
      titleHints: ['Founder', 'CEO', 'Managing Partner', 'Owner'],
      seniorityHints: ['founder', 'c-level', 'partner'],
      disqualifiers: ['freelancer only', 'student'],
    },
    sequence: {
      name: 'Agency founder — 3 touches',
      touches: [
        {
          delayDays: 0,
          subject: '{{company}} — capacity without more headcount',
          body: 'Hi {{firstName}},\n\nAgency teams often lose hours on client follow-up and handoffs.\n\nOpen to a short note on how peers keep pipeline warm without another hire?\n\n{{senderName}}',
        },
        {
          delayDays: 3,
          subject: 'One pattern from agency peers',
          body: 'Hi {{firstName}},\n\nThe pattern: a light multi-step sequence with a human approval before anything goes out — so brand voice stays safe.\n\nWorth a look?\n\n{{senderName}}',
        },
        {
          delayDays: 5,
          subject: 'Timing',
          body: 'Hi {{firstName}},\n\nIf now is busy, I will leave this with you. Happy to reconnect next quarter.\n\n{{senderName}}',
        },
      ],
    },
  },
  {
    key: 'professional_services',
    label: 'Professional services',
    description: 'Reach partners and practice leads in consulting and professional firms.',
    icp: {
      name: 'Practice leads & partners',
      industries: ['consulting', 'professional-services', 'legal', 'accounting'],
      geographies: ['US', 'UK', 'EU', 'global'],
      companySizeHints: ['51-200', '201-1000'],
      titleHints: ['Partner', 'Practice Lead', 'Managing Director', 'Principal'],
      seniorityHints: ['partner', 'director', 'c-level'],
      disqualifiers: ['intern', 'student'],
    },
    sequence: {
      name: 'Practice lead — 3 touches',
      touches: [
        {
          delayDays: 0,
          subject: '{{company}} — client follow-through',
          body: 'Hi {{firstName}},\n\nPractice teams often depend on personal follow-up after a good conversation.\n\nWould a short example of governed outreach (human-approved steps) be relevant?\n\n{{senderName}}\n{{senderTitle}}',
        },
        {
          delayDays: 4,
          subject: 'Example playbook',
          body: 'Hi {{firstName}},\n\nHappy to share a lightweight playbook: who to contact, three steps, and when a human should approve before send.\n\n{{senderName}}',
        },
        {
          delayDays: 6,
          subject: 'Leave with you',
          body: 'Hi {{firstName}},\n\nI will close the loop on my side. Reach out anytime if client follow-through becomes a priority.\n\n{{senderName}}',
        },
      ],
    },
  },
];

export function listGtmStarterPacks(): readonly GtmStarterPackDefinition[] {
  return GTM_STARTER_PACKS;
}

export function getGtmStarterPack(key: string): GtmStarterPackDefinition | null {
  const k = key.trim().toLowerCase();
  return GTM_STARTER_PACKS.find((p) => p.key === k) ?? null;
}
