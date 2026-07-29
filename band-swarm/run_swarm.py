"""Start the research swarm: all six Band agents in one asyncio process.

    uv run python run_swarm.py                 # all six agents
    uv run python run_swarm.py --only scout    # smoke-test one role

Leave it running; runs are started separately (kickoff.py or the app's
Research button with USE_REAL_BAND=1). Ctrl-C is the emergency stop — no
agent wakes without this process alive.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

from band import configure_logging

from band_swarm import config
from band_swarm.agents import build_agent


async def run_agents(roles: list[str]) -> None:
    agents = [build_agent(role) for role in roles]
    print(f"starting {len(agents)} agent(s): {', '.join(config.LABELS[r] for r in roles)}")
    await asyncio.gather(*(agent.run() for agent in agents))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the SwarmAds Band research swarm")
    parser.add_argument(
        "--only",
        action="append",
        choices=config.ROLES,
        help="run only this role (repeatable); default is all six",
    )
    args = parser.parse_args()
    roles = args.only or config.ROLES

    missing = config.missing_credentials(roles)
    if missing:
        print(
            "Missing credentials in band-swarm/.env (see .env.example):\n  " + "\n  ".join(missing),
            file=sys.stderr,
        )
        sys.exit(2)

    configure_logging()
    try:
        asyncio.run(run_agents(roles))
    except KeyboardInterrupt:
        print("swarm stopped")


if __name__ == "__main__":
    main()
