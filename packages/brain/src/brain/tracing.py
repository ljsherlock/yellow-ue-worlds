"""Python boundary tracing — mirrors the TS `@yellow-ue/tracing` BoundaryEvent.

The event shape is byte-for-byte compatible with the TypeScript
`BoundaryEvent` (snake_case fields), so the brain's spans can be returned in
the HTTP response and folded straight into the Pipeline Trace Viewer (R3).
"""

from __future__ import annotations

import contextvars
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from functools import wraps
from typing import Any, Callable, Iterator, Optional, TypeVar

F = TypeVar("F", bound=Callable[..., Any])


@dataclass
class BoundaryEvent:
    trace_id: str
    span_id: str
    name: str
    status: str
    start_ts: int
    end_ts: int
    duration_ms: int
    parent_span_id: Optional[str] = None
    inputs: Any = None
    output: Any = None
    error: Optional[dict] = None

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "name": self.name,
            "status": self.status,
            "start_ts": self.start_ts,
            "end_ts": self.end_ts,
            "duration_ms": self.duration_ms,
        }
        if self.parent_span_id is not None:
            d["parent_span_id"] = self.parent_span_id
        if self.inputs is not None:
            d["inputs"] = self.inputs
        if self.output is not None:
            d["output"] = self.output
        if self.error is not None:
            d["error"] = self.error
        return d


_span_stack: contextvars.ContextVar[Optional[list[dict]]] = contextvars.ContextVar(
    "brain_span_stack", default=None
)
_collector: contextvars.ContextVar[Optional[list[BoundaryEvent]]] = contextvars.ContextVar(
    "brain_collector", default=None
)


def _gen_id() -> str:
    return uuid.uuid4().hex[:12]


def _now_ms() -> int:
    return int(time.time() * 1000)


def _emit(event: BoundaryEvent) -> None:
    collector = _collector.get()
    if collector is not None:
        collector.append(event)


@contextmanager
def trace_context(trace_id: Optional[str] = None) -> Iterator[list[BoundaryEvent]]:
    """Open a logical trace. Boundary calls inside collect into the yielded list."""
    tid = trace_id or _gen_id()
    root = {"trace_id": tid, "span_id": tid}
    events: list[BoundaryEvent] = []
    stack_token = _span_stack.set([root])
    coll_token = _collector.set(events)
    try:
        yield events
    finally:
        _span_stack.reset(stack_token)
        _collector.reset(coll_token)


def boundary(name: str) -> Callable[[F], F]:
    """Decorator: emit a BoundaryEvent for every call of the wrapped function."""

    def decorator(fn: F) -> F:
        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            stack = _span_stack.get()
            if stack is None:
                stack = []
                _span_stack.set(stack)
            parent = stack[-1] if stack else None
            span_id = _gen_id()
            trace_id = parent["trace_id"] if parent else span_id
            start = _now_ms()
            stack.append({"trace_id": trace_id, "span_id": span_id})
            parent_span_id = parent["span_id"] if parent else None
            try:
                out = fn(*args, **kwargs)
                end = _now_ms()
                _emit(
                    BoundaryEvent(
                        trace_id=trace_id,
                        span_id=span_id,
                        name=name,
                        status="ok",
                        start_ts=start,
                        end_ts=end,
                        duration_ms=end - start,
                        parent_span_id=parent_span_id,
                    )
                )
                return out
            except Exception as exc:  # noqa: BLE001 - record then re-raise
                end = _now_ms()
                _emit(
                    BoundaryEvent(
                        trace_id=trace_id,
                        span_id=span_id,
                        name=name,
                        status="error",
                        start_ts=start,
                        end_ts=end,
                        duration_ms=end - start,
                        parent_span_id=parent_span_id,
                        error={"message": str(exc)},
                    )
                )
                raise
            finally:
                stack.pop()

        return wrapper  # type: ignore[return-value]

    return decorator


def traced(name: str, fn: Callable[[], Any]) -> Any:
    """Run a zero-arg callable inside a named boundary span."""
    return boundary(name)(fn)()
