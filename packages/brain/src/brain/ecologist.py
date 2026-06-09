"""The director's ecologist: a vague prompt → a validated, populated SceneSpec.

This is the tier that reasons about *what naturally belongs* in a scene and how
species relate. It wraps an `LLMProvider.populate` call in a traced boundary and
validates the result against the canonical scene-spec contract (R4) before
handing it back. The deterministic behaviour sim (`@yellow-ue/world-model`)
turns that scene into motion.
"""

from __future__ import annotations

from . import contracts
from .providers import LLMProvider
from .tracing import boundary


class Ecologist:
    def __init__(self, provider: LLMProvider) -> None:
        self.provider = provider

    @boundary("brain.ecologist.populate")
    def populate(self, prompt: str) -> dict:
        plan = boundary("brain.provider.populate")(
            lambda: self.provider.populate(prompt)
        )()
        scene = contracts.coerce_scene(plan.scene)
        return {
            "scene": scene,
            "reasoning": plan.reasoning,
            "model": plan.model,
            "tokens": {"input": plan.input_tokens, "output": plan.output_tokens},
        }
