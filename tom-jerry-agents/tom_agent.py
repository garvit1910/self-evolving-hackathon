"""Tom the cat agent (Anthropic)."""

from __future__ import annotations

import asyncio
import logging
import os

from dotenv import load_dotenv

from characters import generate_tom_prompt

from band import Agent
from band.adapters import AnthropicAdapter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    load_dotenv()

    ws_url = os.getenv("BAND_WS_URL")
    rest_url = os.getenv("BAND_REST_URL")

    if not ws_url:
        raise ValueError("BAND_WS_URL environment variable is required")
    if not rest_url:
        raise ValueError("BAND_REST_URL environment variable is required")

    # Load Tom's credentials from agent_config.yaml
    # Create adapter with Tom's character prompt
    adapter = AnthropicAdapter(
        model="claude-sonnet-4-5-20250929",
        prompt=generate_tom_prompt("Tom"),
    )

    # Create and start agent
    agent = Agent.from_config(
        "tom_agent",
        adapter=adapter,
        ws_url=ws_url,
        rest_url=rest_url,
    )

    logger.info("Tom is on the prowl, looking for Jerry...")
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
