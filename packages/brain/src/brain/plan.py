"""One-shot planner CLI: a prompt in, a WorldAPICall[] plan out (as JSON on stdout).

    uv run python -m brain.plan "the elephant herd migrates to the watering hole at sunset and drinks"

stdout is *only* the tool-call array, so it pipes straight into the rc-bridge
runner (`rc-bridge run`). The model + reasoning go to stderr. Uses the same
agent/provider as the HTTP service — the deterministic FakeProvider with no API
key, or Gemini when GOOGLE_API_KEY is set.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .agent import BrainAgent
from .providers import make_provider


def _load_env() -> None:
    """Pick up packages/brain/.env (for GOOGLE_API_KEY) before make_provider()."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    load_dotenv()


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print('usage: python -m brain.plan "<prompt>"', file=sys.stderr)
        return 2

    _load_env()
    prompt = " ".join(args)
    agent = BrainAgent(make_provider())
    result = agent.run(prompt)

    json.dump(result["toolCalls"], sys.stdout)
    sys.stdout.write("\n")
    print(f"[brain:{result['model']}] {result['reasoning']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
