"""HTTP service tests using the FakeProvider — no API key required."""

from __future__ import annotations

from fastapi.testclient import TestClient

from brain.agent import BrainAgent
from brain.app import create_app
from brain.providers import FakeProvider


def make_client() -> TestClient:
    return TestClient(create_app(BrainAgent(FakeProvider())))


def test_health() -> None:
    client = make_client()
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "provider": "fake"}


def test_complete_returns_result_and_spans() -> None:
    client = make_client()
    res = client.post("/complete", json={"prompt": "make it stormy"})
    assert res.status_code == 200
    body = res.json()
    assert body["result"]["toolCalls"][0]["tool"] == "SetSkyState"
    assert len(body["spans"]) >= 4
    # spans are TS-BoundaryEvent shaped
    span = body["spans"][0]
    assert {"trace_id", "span_id", "name", "status", "duration_ms"} <= set(span)


def test_complete_rejects_empty_prompt() -> None:
    client = make_client()
    res = client.post("/complete", json={"prompt": ""})
    # empty prompt violates the request schema (minLength 1) → 422
    assert res.status_code == 422
