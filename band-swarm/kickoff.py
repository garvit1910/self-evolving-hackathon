"""Kick off one research run through the Band swarm.

    uv run python kickoff.py <brandId> <brandUrl> [appBase]

Acts as the Conductor over REST (the swarm agents must already be running via
run_swarm.py): creates a FRESH Band room per run (`swarm:<brandId> · <ts>` —
previous sessions stay cached for demos), adds all agents + the human owner
as participants, initializes the shared run-state, posts the kickoff message
mentioning the Cartographer, then polls the app until facts land (or times
out). Exit 0 = facts published; exit 1 = no facts (the app's research route
falls back to the interim researcher on non-zero exit).

Room override: set BAND_ROOM_ID to a chat UUID to skip creation
(e.g. a room created by hand in the Band dashboard).
"""

from __future__ import annotations

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
import time

import httpx
from band_rest import ChatMessageRequest, ChatRoomRequest, ParticipantRequest, RestClient
from band_rest.types import ChatMessageRequestMentionsItem

from band_swarm import config, runstate

POLL_INTERVAL_S = 5.0


def fact_count(app: str, brand_id: str) -> int | None:
    try:
        res = httpx.get(f"{app}/api/brands/{brand_id}/context", timeout=10.0)
        if not res.is_success:
            return None
        return len(res.json().get("facts", []))
    except Exception:
        return None


def post_app_event(app: str, brand_id: str, message: str, status: str = "running") -> None:
    try:
        httpx.post(
            f"{app}/api/brands/{brand_id}/events",
            json={"step": "research", "status": status, "payload": {"agent": "Conductor", "message": message}},
            timeout=10.0,
        )
    except Exception:
        pass


def resolve_room(client: RestClient, brand_id: str) -> str:
    """A FRESH room per run (timestamped title): the new conversation starts
    clean — no stale history in the agents' context — while previous sessions
    survive untouched in the Band console and the app's session picker as
    cached demos. BAND_ROOM_ID pins a specific room instead."""
    if os.environ.get("BAND_ROOM_ID"):
        return os.environ["BAND_ROOM_ID"]
    title = f"swarm:{brand_id} · {time.strftime('%m-%d %H:%M')}"
    created = client.agent_api_chats.create_agent_chat(chat=ChatRoomRequest(title=title))
    print(f"kickoff: created room {created.data.id} ({title})")
    return created.data.id


def ensure_participants(client: RestClient, room_id: str) -> None:
    present = {p.id for p in client.agent_api_participants.list_agent_chat_participants(room_id).data}
    for role in config.ROLES:
        agent_id, _ = config.credentials(role)
        if agent_id in present:
            continue
        try:
            client.agent_api_participants.add_agent_chat_participant(
                room_id, participant=ParticipantRequest(participant_id=agent_id)
            )
            print(f"kickoff: added {config.LABELS[role]} to the room")
        except Exception as e:
            # Cartographer must receive the kickoff mention; everyone else can
            # be pulled in by peers via band_add_participant (prompt rule 3).
            if role == "cartographer":
                raise SystemExit(f"kickoff: could not add Cartographer to room {room_id}: {e}")
            print(f"kickoff: warning — could not add {config.LABELS[role]}: {e}", file=sys.stderr)


def ensure_owner_participant(client: RestClient, room_id: str) -> None:
    """Add the human owner (User-type peer) so they can open the room in the
    Band dashboard and @mention agents mid-run. Warn-don't-fail: the run works
    without them; only the ping demo needs it. (If the agent-key add is ever
    forbidden, the human API — POST /api/v1/me/chats/{id}/participants with
    BAND_USER_API_KEY — is the fallback.)"""
    try:
        present = {p.id for p in client.agent_api_participants.list_agent_chat_participants(room_id).data}
        users = [p for p in client.agent_api_peers.list_agent_peers().data if p.type == "User"]
        for user in users:
            if user.id in present:
                continue
            client.agent_api_participants.add_agent_chat_participant(
                room_id, participant=ParticipantRequest(participant_id=user.id)
            )
            print(f"kickoff: added owner {user.name or user.handle} to the room")
    except Exception as e:
        print(f"kickoff: warning — could not add the owner to the room: {e}", file=sys.stderr)


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: uv run python kickoff.py <brandId> <brandUrl> [appBase]", file=sys.stderr)
        return 2
    brand_id, brand_url = sys.argv[1], sys.argv[2]
    app = (sys.argv[3] if len(sys.argv) > 3 else config.app_base()).rstrip("/")

    before = fact_count(app, brand_id)
    if before is None:
        print(f"kickoff: app not reachable or unknown brand at {app}/api/brands/{brand_id}", file=sys.stderr)
        return 1

    _, conductor_key = config.credentials("conductor")
    client = RestClient(api_key=conductor_key, base_url=config.band_rest_url())

    room_id = resolve_room(client, brand_id)
    ensure_participants(client, room_id)
    ensure_owner_participant(client, room_id)
    runstate.init_run(brand_id, brand_url, app)

    cartographer_id, _ = config.credentials("cartographer")
    handle = next(
        (p.handle for p in client.agent_api_peers.list_agent_peers().data if p.id == cartographer_id),
        None,
    )
    mention_text = f"@{handle}" if handle else "Cartographer"
    client.agent_api_messages.create_agent_chat_message(
        room_id,
        message=ChatMessageRequest(
            content=(
                f"{mention_text} New research run — brandId={brand_id}, url={brand_url}. "
                "Map the site and hand the crawl plan to Scout."
            ),
            mentions=[ChatMessageRequestMentionsItem(id=cartographer_id, handle=handle)],
        ),
    )
    print(f"kickoff: posted kickoff to room {room_id}, waiting for the swarm…")
    post_app_event(app, brand_id, f"Swarm kickoff posted to Band room {room_id} — agents conversing.")

    # more beats than v1: parallel competitor branch + thought events + debate
    # (a live v2 run took ~9.5 min including one tool-retry stall)
    deadline = time.monotonic() + float(os.environ.get("KICKOFF_TIMEOUT_S", "600"))
    while time.monotonic() < deadline:
        time.sleep(POLL_INTERVAL_S)
        now = fact_count(app, brand_id)
        if now is not None and now > before:
            print(f"kickoff: research published ({now - before} new facts)")
            return 0
    print("kickoff: timed out waiting for facts — check run_swarm.py logs / the Band room", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
