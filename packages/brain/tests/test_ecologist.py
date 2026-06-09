"""Ecologist tests using the FakeProvider — no API key required."""

from __future__ import annotations

from fastapi.testclient import TestClient

from brain import contracts
from brain.agent import BrainAgent
from brain.app import create_app
from brain.ecologist import Ecologist
from brain.providers import FakeProvider


def make_client() -> TestClient:
    return TestClient(create_app(BrainAgent(FakeProvider())))


def test_fake_populate_infers_a_savanna() -> None:
    eco = Ecologist(FakeProvider())
    out = eco.populate("a savanna with a watering hole and a jeep")
    species = {s["species"] for s in out["scene"]["species"]}
    assert {"lion", "buffalo", "zebra", "watering_hole", "jeep"} <= species
    # the predator/prey relationship the sim needs is present
    rels = {(r["subject"], r["predicate"], r["object"]) for r in out["scene"]["relationships"]}
    assert ("lion", "stalks", "zebra") in rels


def test_populate_output_satisfies_the_canonical_contract() -> None:
    eco = Ecologist(FakeProvider())
    out = eco.populate("temperate forest with deer and wolves")
    # coerce_scene already validated; assert it stands on its own too (R4)
    contracts.validate_scene(out["scene"])
    # defaults were filled from the generated schema
    for s in out["scene"]["species"]:
        assert "color" in s and "maxSpeed" in s and "radius" in s


def test_populate_endpoint_returns_scene_and_spans() -> None:
    client = make_client()
    res = client.post("/populate", json={"prompt": "savanna at night"})
    assert res.status_code == 200
    body = res.json()
    assert body["result"]["scene"]["weather"]["preset"] == "night"
    assert body["result"]["model"] == "fake-ecologist-v1"
    # nested boundary spans: ecologist.populate → provider.populate
    names = {s["name"] for s in body["spans"]}
    assert "brain.ecologist.populate" in names
    assert "brain.provider.populate" in names


def test_unknown_prompt_falls_back_to_a_valid_meadow() -> None:
    eco = Ecologist(FakeProvider())
    out = eco.populate("somewhere quiet")
    contracts.validate_scene(out["scene"])
    assert any(s["kind"] == "feature" for s in out["scene"]["species"])
