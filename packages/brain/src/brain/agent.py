"""The LangGraph brain agent: prompt → validated WorldAPI tool calls."""

from __future__ import annotations

from typing import Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from . import contracts
from .providers import LLMProvider, ProviderOutput
from .tracing import boundary


class AgentState(TypedDict, total=False):
    prompt: str
    world_context: Optional[str]
    provider_output: ProviderOutput
    result: dict


class BrainAgent:
    """Wraps an `LLMProvider` in a small LangGraph (plan → assemble).

    The graph is intentionally minimal for Track A — its value is the typed
    state, the validated boundary, and the room to grow (memory reads, retries,
    multi-step planning) without changing the LLMClient contract.
    """

    def __init__(self, provider: LLMProvider) -> None:
        self.provider = provider
        self._graph = self._build()

    def _build(self):
        graph = StateGraph(AgentState)
        graph.add_node("plan", self._plan)
        graph.add_node("assemble", self._assemble)
        graph.add_edge(START, "plan")
        graph.add_edge("plan", "assemble")
        graph.add_edge("assemble", END)
        return graph.compile()

    @boundary("brain.plan")
    def _plan(self, state: AgentState) -> dict:
        prompt = state["prompt"]
        context = state.get("world_context")
        output = boundary("brain.provider.generate")(
            lambda: self.provider.generate(prompt, context)
        )()
        return {"provider_output": output}

    @boundary("brain.assemble")
    def _assemble(self, state: AgentState) -> dict:
        out = state["provider_output"]
        result = {
            "toolCalls": out.tool_calls,
            "reasoning": out.reasoning,
            "model": out.model,
            "tokens": {"input": out.input_tokens, "output": out.output_tokens},
            "finishReason": out.finish_reason,
        }
        contracts.validate_result(result)
        return {"result": result}

    @boundary("brain.run")
    def run(self, prompt: str, world_context: Optional[str] = None) -> dict:
        request: dict = {"prompt": prompt}
        if world_context:
            request["worldContext"] = world_context
        contracts.validate_request(request)
        final = self._graph.invoke({"prompt": prompt, "world_context": world_context})
        return final["result"]
