"""Env-backed configuration for the band-swarm agents.

Credential scheme (band-swarm/.env — see .env.example): each role has its own
Band remote agent, so credentials come in per-role pairs
(`CONDUCTOR_AGENT_ID`/`CONDUCTOR_API_KEY`, `SCOUT_…`, etc.) plus one shared
`ANTHROPIC_API_KEY` for the Claude brain. Band Cloud URLs are the default;
`BAND_REST_URL`/`BAND_WS_URL` exist only for self-hosted deployments.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_DIR / ".env")

ROLES = ["conductor", "cartographer", "scout", "analyst", "critic", "personasmith", "competitor"]

LABELS = {
    "conductor": "Conductor",
    "cartographer": "Cartographer",
    "scout": "Scout",
    "analyst": "Analyst",
    "critic": "Critic",
    "personasmith": "Personasmith",
    "competitor": "Competitor",
}


def band_rest_url() -> str:
    return os.environ.get("BAND_REST_URL", "https://app.band.ai").rstrip("/")


def band_ws_url() -> str:
    return os.environ.get("BAND_WS_URL", "wss://app.band.ai/api/v1/socket/websocket")


def swarm_model() -> str:
    return os.environ.get("SWARM_MODEL", "claude-sonnet-4-5")


def app_base() -> str:
    return os.environ.get("APP_BASE", "http://localhost:3002").rstrip("/")


def credential_vars(role: str) -> tuple[str, str]:
    return f"{role.upper()}_AGENT_ID", f"{role.upper()}_API_KEY"


def credentials(role: str) -> tuple[str, str]:
    id_var, key_var = credential_vars(role)
    agent_id, api_key = os.environ.get(id_var, "").strip(), os.environ.get(key_var, "").strip()
    if not agent_id or not api_key:
        raise RuntimeError(
            f"Missing Band credentials for {LABELS[role]}: set {id_var} and {key_var} in "
            f"{PROJECT_DIR / '.env'} (create the agent at app.band.ai, then copy its UUID + API key)."
        )
    return agent_id, api_key


def missing_credentials(roles: list[str] | None = None) -> list[str]:
    """Names of unset env vars for the given roles (plus ANTHROPIC_API_KEY)."""
    missing: list[str] = []
    for role in roles or ROLES:
        for var in credential_vars(role):
            if not os.environ.get(var, "").strip():
                missing.append(var)
    if not os.environ.get("ANTHROPIC_API_KEY", "").strip():
        missing.append("ANTHROPIC_API_KEY")
    return missing
