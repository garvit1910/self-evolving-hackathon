# agents/

Research swarm worker processes. `swarm.ts` runs Scout → Analyst →
Personasmith (implementations in `src/lib/agents/`) as a separate Node
process, coordinating through a Band room and mirroring every message into
the app's `/events` + `/facts` routes.

    npm run swarm -- <brandId> <brandUrl> [appBase]

The app spawns this worker from `POST /api/brands/:id/research` when
`USE_REAL_BAND=1`; otherwise the interim researcher serves the same routes.
