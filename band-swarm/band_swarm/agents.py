"""Build one Band agent per swarm role: AnthropicAdapter (Claude brain +
role-scoped custom tools + Emit.EXECUTION telemetry) connected to that role's
own Band remote-agent identity."""

from __future__ import annotations

from band import AdapterFeatures, Agent, Emit
from band.adapters import AnthropicAdapter

from . import config, prompts, tools


def build_agent(role: str) -> Agent:
    agent_id, api_key = config.credentials(role)
    adapter = AnthropicAdapter(
        model=config.swarm_model(),
        prompt=prompts.for_role(role),
        max_tokens=2048,
        additional_tools=tools.toolset(role, config.LABELS[role]),
        features=AdapterFeatures(emit={Emit.EXECUTION}),
    )
    return Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=config.band_ws_url(),
        rest_url=config.band_rest_url(),
    )
