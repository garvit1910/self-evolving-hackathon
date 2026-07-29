// One color identity per swarm agent, shared by the mirrored event feed and
// the Band room transcript. Hues sit in the mission-control dark palette.
export const AGENT_STYLES: Record<string, { fg: string; bg: string }> = {
  Conductor: { fg: 'text-[#a371f7]', bg: 'bg-[#a371f7]' },
  Cartographer: { fg: 'text-[#d29922]', bg: 'bg-[#d29922]' },
  Scout: { fg: 'text-accent', bg: 'bg-accent' },
  Analyst: { fg: 'text-[#3987e5]', bg: 'bg-[#3987e5]' },
  Critic: { fg: 'text-[#f85149]', bg: 'bg-[#f85149]' },
  Personasmith: { fg: 'text-[#d55181]', bg: 'bg-[#d55181]' },
  Competitor: { fg: 'text-[#39c5cf]', bg: 'bg-[#39c5cf]' },
  Autopilot: { fg: 'text-mut', bg: 'bg-mut' },
};

/** Humans (the owner pinging from the Band console) get the plain-fg badge. */
export function styleFor(sender: string, senderType?: string) {
  if (senderType === 'User') return { fg: 'text-fg', bg: 'bg-fg' };
  return AGENT_STYLES[sender] ?? AGENT_STYLES.Autopilot;
}
