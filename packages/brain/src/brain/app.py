"""FastAPI service exposing the brain behind the LLMClient boundary.

`POST /complete` returns `{ result, spans }` — the result is a validated
`LLMCompletionResult`, and `spans` are the brain's internal BoundaryEvents so
the TS `BrainHttpClient` can fold them into the Pipeline Trace Viewer.
"""

from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .agent import BrainAgent
from .providers import make_provider
from .tracing import trace_context


class CompleteRequest(BaseModel):
    prompt: str
    worldContext: Optional[str] = None


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

    return app


app = create_app()
