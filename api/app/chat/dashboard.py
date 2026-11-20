"""The dashboard the assistant edits: widget schema (what the model may send) and the reducer (what changes on screen).

Port of `src/chat/widget-schema.ts` and `src/dashboard/reducer.ts`. A dashboard is plain JSON (a dict), so it is stored and sent
as is; widgets are validated against `WIDGET` before they reach the reducer.
"""

from dataclasses import dataclass, field
from typing import Annotated, Any, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

Dashboard = dict[str, Any]
Action = dict[str, Any]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Widget(_Strict):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    size: Literal["sm", "md", "lg"]


class Point(_Strict):
    label: str
    value: float


class Kpi(_Widget):
    kind: Literal["kpi"]
    value: str
    caption: str | None = None


class Bar(_Widget):
    kind: Literal["bar"]
    data: list[Point]


class Line(_Widget):
    kind: Literal["line"]
    data: list[Point]


class BreakdownItem(_Strict):
    label: str
    amount: float


class Breakdown(_Widget):
    kind: Literal["breakdown"]
    items: list[BreakdownItem]


class OpportunityItem(_Strict):
    title: str
    monthly_savings: float = Field(alias="monthlySavings")


class Opportunities(_Widget):
    kind: Literal["opportunities"]
    items: list[OpportunityItem]


class DeadlineItem(_Strict):
    label: str
    date: str


class Deadlines(_Widget):
    kind: Literal["deadlines"]
    items: list[DeadlineItem]


class CompareRow(_Strict):
    label: str
    today: str
    potential: str


class Compare(_Widget):
    kind: Literal["compare"]
    rows: list[CompareRow]
    summary: str | None = None
    labels: tuple[str, str] | None = None


class ChecklistItem(_Strict):
    label: str
    done: bool


class Checklist(_Widget):
    kind: Literal["checklist"]
    items: list[ChecklistItem]


class Text(_Widget):
    kind: Literal["text"]
    body: str


Widget = Annotated[
    Kpi | Bar | Line | Breakdown | Opportunities | Deadlines | Compare | Checklist | Text, Field(discriminator="kind")
]
WIDGET: TypeAdapter[Any] = TypeAdapter(cast(Any, Widget))


def validate_widget(raw: Any) -> dict[str, Any]:
    """A widget as the model sent it, checked and in its stored (JSON) form. Raises pydantic's ValidationError."""
    return WIDGET.dump_python(WIDGET.validate_python(raw), mode="json", by_alias=True, exclude_none=True)  # type: ignore[no-any-return]


def new_dashboard(name: str = "Painel", dashboard_id: str = "dashboard") -> Dashboard:
    return {"id": dashboard_id, "name": name, "theme": "light", "density": "comfortable", "widgets": [], "version": 1}


@dataclass(frozen=True)
class History:
    present: Dashboard
    past: list[Dashboard] = field(default_factory=list)


def reduce(state: History, action: Action) -> History:
    """The next history for an action; an action that does not apply returns the same state."""
    d = state.present
    widgets: list[dict[str, Any]] = d["widgets"]

    def commit(**changes: Any) -> History:
        return History({**d, **changes, "version": d["version"] + 1}, [*state.past, d])

    def has(widget_id: str) -> bool:
        return any(w["id"] == widget_id for w in widgets)

    kind = action["type"]
    if kind == "undo":
        return History(state.past[-1], state.past[:-1]) if state.past else state
    if kind == "add":
        if has(action["widget"]["id"]):
            return state
        out = list(widgets)
        index = action.get("index")
        out.insert(len(out) if index is None else index, action["widget"])
        return commit(widgets=out)
    if kind == "update":
        current = next((w for w in widgets if w["id"] == action["widget"]["id"]), None)
        # A block never changes kind: its data fields only make sense for the kind it was created with.
        if current is None or current["kind"] != action["widget"]["kind"]:
            return state
        return commit(widgets=[action["widget"] if w["id"] == current["id"] else w for w in widgets])
    if kind == "remove":
        return commit(widgets=[w for w in widgets if w["id"] != action["id"]]) if has(action["id"]) else state
    if kind == "reorder":
        source = next((i for i, w in enumerate(widgets) if w["id"] == action["id"]), -1)
        if source < 0:
            return state
        out = list(widgets)
        moved = out.pop(source)
        out.insert(action["toIndex"], moved)
        return commit(widgets=out)
    if kind == "setTheme":
        return commit(theme=action["theme"])
    if kind == "setDensity":
        return commit(density=action["density"])
    if kind == "rename":
        return commit(name=action["name"])
    raise ValueError(f"unknown dashboard action: {kind}")
