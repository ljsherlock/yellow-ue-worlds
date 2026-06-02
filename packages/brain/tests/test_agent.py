"""Agent tests using the FakeProvider — no API key required."""

from __future__ import annotations

import pytest

from brain import contracts
from brain.agent import BrainAgent
from brain.providers import FakeProvider
from brain.tracing import trace_context


@pytest.fixture()
def agent() -> BrainAgent:
    return BrainAgent(FakeProvider())


def test_sky_prompt_maps_to_set_sky_state(agent: BrainAgent) -> None:
    with trace_context():
        result = agent.run("make it stormy")
    assert result["toolCalls"][0]["tool"] == "SetSkyState"
    assert result["toolCalls"][0]["args"]["preset"] == "storm"
    assert result["finishReason"] == "tool_calls"


def test_time_prompt_maps_to_advance_time(agent: BrainAgent) -> None:
    with trace_context():
        result = agent.run("fast forward 6 hours at 100x speed")
    call = result["toolCalls"][0]
    assert call["tool"] == "AdvanceTime"
    assert call["args"]["hours"] == 6
    assert call["args"]["speed_multiplier"] == 100


def test_tree_prompt_maps_to_spawn_trees(agent: BrainAgent) -> None:
    with trace_context():
        result = agent.run("plant 40 pine seedlings")
    call = result["toolCalls"][0]
    assert call["tool"] == "SpawnTrees"
    assert call["args"]["count"] == 40
    assert call["args"]["species"] == "pine"
    assert call["args"]["growth_stage"] == "seedling"


def test_compound_prompt_emits_multiple_calls(agent: BrainAgent) -> None:
    with trace_context():
        result = agent.run("make it a stormy night, advance a day, and plant 10 oaks")
    tools = {c["tool"] for c in result["toolCalls"]}
    assert {"SetSkyState", "AdvanceTime", "SpawnTrees"}.issubset(tools)


def test_unmatched_prompt_returns_no_tool_calls(agent: BrainAgent) -> None:
    with trace_context():
        result = agent.run("hello there")
    assert result["toolCalls"] == []
    assert result["finishReason"] == "stop"


def test_result_validates_against_contract(agent: BrainAgent) -> None:
    with trace_context():
        result = agent.run("make it stormy")
    # Must not raise — validates against the JSON Schema generated from Zod (R4).
    contracts.validate_result(result)


def test_run_emits_nested_boundary_spans(agent: BrainAgent) -> None:
    with trace_context() as spans:
        agent.run("make it stormy")
    names = [s.name for s in spans]
    assert "brain.run" in names
    assert "brain.plan" in names
    assert "brain.provider.generate" in names
    assert "brain.assemble" in names
    # spans share one trace id
    assert len({s.trace_id for s in spans}) == 1
