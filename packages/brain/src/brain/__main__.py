"""Run the brain service: `uv run python -m brain` (or `uv run brain-serve`)."""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.environ.get("BRAIN_HOST", "127.0.0.1")
    port = int(os.environ.get("BRAIN_PORT", "8000"))
    uvicorn.run("brain.app:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
