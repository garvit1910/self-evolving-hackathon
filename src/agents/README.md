# agents/

LEGACY research swarm worker. `swarm.ts` runs Scout → Analyst → Personasmith
(implementations in `src/lib/agents/`) as a separate Node process, posting to
a Band room through ONE agent identity (`BAND_API_KEY`) and mirroring every
message into the app's `/events` + `/facts` routes.

    npm run swarm -- <brandId> <brandUrl> [appBase]

The live path is now `band-swarm/` — six real Band agents conversing via the
Band SDK. `POST /api/brands/:id/research` with `USE_REAL_BAND=1` kicks that
off (`band-swarm/kickoff.py`); this worker only runs when `BAND_KICKOFF=ts`
is also set. Unset `USE_REAL_BAND` = interim researcher on the same routes.
