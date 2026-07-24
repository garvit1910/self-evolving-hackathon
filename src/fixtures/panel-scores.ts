import type { PanelScore } from '@/lib/contracts';

// Hand-written persona-panel appeal scores (0–100) per creative × persona.
// A real LLM panel replaces this file later; the shape stays.
export const panelScores: PanelScore[] = [
  // cr-g1-01 — nostalgia-reboot × retro-cartoon
  { creativeId: 'cr-g1-01', persona: 'nostalgic fitness enthusiast', appealScore: 92, reason: 'Direct hit on the Saturday-morning memory plus a protein number they track.' },
  { creativeId: 'cr-g1-01', persona: 'keto parent', appealScore: 64, reason: 'Cartoon vibe reads kid-targeted; parent wants the label facts first.' },
  { creativeId: 'cr-g1-01', persona: 'sugar-quitting cereal lover', appealScore: 81, reason: 'The ritual callback lands; wants reassurance the crash is really gone.' },
  // cr-g1-02 — nostalgia-reboot × clean-clinical
  { creativeId: 'cr-g1-02', persona: 'nostalgic fitness enthusiast', appealScore: 78, reason: 'Loves the re-engineered framing but misses the visual nostalgia punch.' },
  { creativeId: 'cr-g1-02', persona: 'keto parent', appealScore: 71, reason: 'Clinical layout builds trust; ritual language is secondary for them.' },
  { creativeId: 'cr-g1-02', persona: 'sugar-quitting cereal lover', appealScore: 88, reason: "'Un-quit' speaks straight to the hardest goodbye of their sugar detox." },
  // cr-g1-03 — zero-sugar-flex × retro-cartoon
  { creativeId: 'cr-g1-03', persona: 'nostalgic fitness enthusiast', appealScore: 70, reason: 'Zero sugar is table stakes; they care more about the protein math.' },
  { creativeId: 'cr-g1-03', persona: 'keto parent', appealScore: 66, reason: "Likes the claim, distrusts the cartoon wrapper — 'is this candy?'" },
  { creativeId: 'cr-g1-03', persona: 'sugar-quitting cereal lover', appealScore: 84, reason: "The double-take dare ('check the label twice') matches their skepticism." },
  // cr-g1-04 — zero-sugar-flex × clean-clinical
  { creativeId: 'cr-g1-04', persona: 'nostalgic fitness enthusiast', appealScore: 62, reason: 'Household-harmony framing is not their problem; feels aimed elsewhere.' },
  { creativeId: 'cr-g1-04', persona: 'keto parent', appealScore: 86, reason: "'No label fight' names their exact morning; clinical style seals trust." },
  { creativeId: 'cr-g1-04', persona: 'sugar-quitting cereal lover', appealScore: 74, reason: 'Credible claim, but the family angle dilutes the personal win.' },
  // cr-g1-05 — macro-math × clean-clinical
  { creativeId: 'cr-g1-05', persona: 'nostalgic fitness enthusiast', appealScore: 87, reason: 'Macros up front, no fluff — exactly how they evaluate food.' },
  { creativeId: 'cr-g1-05', persona: 'keto parent', appealScore: 79, reason: 'Numbers-first pitch survives their label scrutiny.' },
  { creativeId: 'cr-g1-05', persona: 'sugar-quitting cereal lover', appealScore: 60, reason: 'Spec sheet with no joy; they quit sugar, not pleasure.' },
  // cr-g1-06 — macro-math × retro-cartoon
  { creativeId: 'cr-g1-06', persona: 'nostalgic fitness enthusiast', appealScore: 75, reason: 'Fun wrapper on real numbers works, though less sharp than pure spec.' },
  { creativeId: 'cr-g1-06', persona: 'keto parent', appealScore: 68, reason: 'Right macros, wrong costume — cartoon undercuts the health case.' },
  { creativeId: 'cr-g1-06', persona: 'sugar-quitting cereal lover', appealScore: 65, reason: 'Macros are not the hook for them; the fun art helps a little.' },
  // cr-g1-07 — kid-cereal-for-adults × retro-cartoon
  { creativeId: 'cr-g1-07', persona: 'nostalgic fitness enthusiast', appealScore: 80, reason: "'Grew up' framing flatters them; adjacent to the nostalgia hit they want." },
  { creativeId: 'cr-g1-07', persona: 'keto parent', appealScore: 63, reason: 'Amusing but vague on the numbers that decide their purchases.' },
  { creativeId: 'cr-g1-07', persona: 'sugar-quitting cereal lover', appealScore: 72, reason: 'Permission to enjoy cereal again, though less pointed than the quit story.' },
  // cr-g1-08 — kid-cereal-for-adults × clean-clinical
  { creativeId: 'cr-g1-08', persona: 'nostalgic fitness enthusiast', appealScore: 69, reason: "'Adult money' joke lands, but the pitch is lifestyle, not performance." },
  { creativeId: 'cr-g1-08', persona: 'keto parent', appealScore: 61, reason: 'Indulgence framing is what they are trying to leave behind.' },
  { creativeId: 'cr-g1-08', persona: 'sugar-quitting cereal lover', appealScore: 77, reason: 'Treat-without-relapse promise fits; wants the sugar proof closer to the joke.' },
];
