"""FastAPI service exposing the brain behind the LLMClient boundary.

`POST /complete` returns `{ result, spans }` — the result is a validated
`LLMCompletionResult`, and `spans` are the brain's internal BoundaryEvents so
the TS `BrainHttpClient` can fold them into the Pipeline Trace Viewer.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .agent import BrainAgent
from .ecologist import Ecologist
from .providers import make_provider
from .tracing import trace_context


def _load_env() -> None:
    """Load `packages/brain/.env` (and any .env found from cwd) so a dropped-in
    GOOGLE_API_KEY is picked up. Must run before `make_provider()` reads env."""
    try:
        from dotenv import load_dotenv
    except ImportError:  # dotenv is optional; env vars still work without it
        return
    # src/brain/app.py → parents[2] == packages/brain
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    load_dotenv()


_load_env()


class CompleteRequest(BaseModel):
    prompt: str
    worldContext: Optional[str] = None


class PopulateRequest(BaseModel):
    prompt: str


def create_app(agent: Optional[BrainAgent] = None) -> FastAPI:
    app = FastAPI(title="yellow-ue-worlds brain", version="0.0.1")
    # The inspector (a browser app) calls this directly during development.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    resolved_agent = agent or BrainAgent(make_provider())
    # The ecologist shares the agent's provider so /complete and /populate agree
    # on which backend (fake vs gemini) is live.
    ecologist = Ecologist(resolved_agent.provider)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "provider": resolved_agent.provider.name}

    @app.post("/complete")
    def complete(req: CompleteRequest) -> dict:
        try:
            with trace_context() as spans:
                result = resolved_agent.run(req.prompt, req.worldContext)
            return {"result": result, "spans": [e.to_dict() for e in spans]}
        except Exception as exc:  # noqa: BLE001 - surface as 422 to the caller
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/populate")
    def populate(req: PopulateRequest) -> dict:
        try:
            with trace_context() as spans:
                result = ecologist.populate(req.prompt)
            return {"result": result, "spans": [e.to_dict() for e in spans]}
        except Exception as exc:  # noqa: BLE001 - surface as 422 to the caller
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return app


app = create_app()
