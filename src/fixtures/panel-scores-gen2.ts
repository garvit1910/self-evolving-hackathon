import type { PanelScore } from '@/lib/contracts';

// Gen-2 panel scores — high band (85–96): these creatives exploit the learned
// winner, so the panel loves them. Feeds the sim's panelFactor, which (with
// zero fatigue on fresh adIds) is what lets gen-2 beat the decayed gen-1 arms.
export const gen2PanelScores: PanelScore[] = [
  // cr-g2-01 — nostalgia-reboot × retro-cartoon
  { creativeId: 'cr-g2-01', persona: 'nostalgic fitness enthusiast', appealScore: 96, reason: 'The callback plus the protein number — this is the ad they would screenshot.' },
  { creativeId: 'cr-g2-01', persona: 'keto parent', appealScore: 85, reason: 'Learned framing keeps the macros up front; cartoon reads charming now, not childish.' },
  { creativeId: 'cr-g2-01', persona: 'sugar-quitting cereal lover', appealScore: 92, reason: '“Zero crash” answers their exact fear before they can raise it.' },
  // cr-g2-02 — nostalgia-reboot × retro-cartoon
  { creativeId: 'cr-g2-02', persona: 'nostalgic fitness enthusiast', appealScore: 90, reason: 'Grew-up-with-you framing hits the identity note the panel flagged in gen-1.' },
  { creativeId: 'cr-g2-02', persona: 'keto parent', appealScore: 86, reason: 'Memory-without-sugar is the pitch they forward to the family group chat.' },
  { creativeId: 'cr-g2-02', persona: 'sugar-quitting cereal lover', appealScore: 95, reason: 'Speaks straight to the quitting story — the strongest hook of the batch for them.' },
  // cr-g2-03 — nostalgia-reboot × clean-clinical
  { creativeId: 'cr-g2-03', persona: 'nostalgic fitness enthusiast', appealScore: 87, reason: 'Less visual nostalgia, but the macro line keeps their attention.' },
  { creativeId: 'cr-g2-03', persona: 'keto parent', appealScore: 94, reason: 'Zero morning negotiations names their day; clinical layout seals the trust.' },
  { creativeId: 'cr-g2-03', persona: 'sugar-quitting cereal lover', appealScore: 88, reason: 'Label-first framing survives their skepticism with the nostalgia intact.' },
  // cr-g2-04 — nostalgia-reboot × retro-cartoon
  { creativeId: 'cr-g2-04', persona: 'nostalgic fitness enthusiast', appealScore: 93, reason: 'Rerun metaphor plus adult macros — both halves of their identity in one line.' },
  { creativeId: 'cr-g2-04', persona: 'keto parent', appealScore: 85, reason: 'Back-on-the-menu framing works for the whole table, not just the kid in them.' },
  { creativeId: 'cr-g2-04', persona: 'sugar-quitting cereal lover', appealScore: 91, reason: 'Childhood flavor with adult macros is the permission slip they wanted.' },
];
