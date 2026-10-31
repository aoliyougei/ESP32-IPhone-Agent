"""Web API + control page. Run with `python -m hidagent`."""

import asyncio
import base64
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .agent import Agent
from .debug import Trace
from .detection import DetectionBusy, DetectionError, Detector
from .device import Device, DeviceError
from .llm import LLM
from .phone import Phone
from .screen import Screen

DATA_DIR = Path(os.environ.get("HIDAGENT_DATA", Path.home() / ".hidagent"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DEBUG = os.environ.get("HIDAGENT_DEBUG") == "1"

detection_task = None

detector = Detector(Path(os.environ.get("HIDAGENT_YOLO_MODEL", DATA_DIR / "best.pt")),
                    os.environ.get("HIDAGENT_YOLO_DEVICE", "cpu"))
device = Device()
screen = Screen(os.environ.get("AIRPLAY_NAME", "iPhone Agent"))
phone = Phone(device, DATA_DIR / "calibration.json", screen,
              axis_move=os.environ.get("HIDAGENT_AXIS_MOVE", "0") == "1")
agent = Agent(phone, screen, LLM.from_env("ACTOR"), LLM.from_env("PLANNER"),
              Trace(DATA_DIR / "traces" if DEBUG else None))


@asynccontextmanager
async def lifespan(_):
    server = await device.serve("0.0.0.0", int(os.environ.get("DEVICE_PORT", 7300)))
    screen.start()
    awake = asyncio.create_task(device.keep_awake(screen=screen))
    yield
    awake.cancel()
    screen.stop()
    server.close()


app = FastAPI(lifespan=lifespan)
class Static(StaticFiles):
    """Static files that browsers re-check on every load, so a new version shows up on refresh."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/static", Static(directory=Path(__file__).parent / "static"), name="static")


class Point(BaseModel):
    x: float
    y: float


class Swipe(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class Scroll(Point):
    lines: int


class Text(BaseModel):
    text: str


async def act(coro):
    try:
        await coro
    except (DeviceError, RuntimeError) as e:
        raise HTTPException(409, str(e)) from e
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/api/status")
def status():
    return {"device": device.connected, "screen": screen.live, "calibrated": phone.calibrated,
            "debug": DEBUG, "trace": str(agent.trace.dir or ""), "aspect": round(screen.aspect, 4),
            "pointer_mode": "axis" if phone.axis_move else "combined",
            "models": {"planner": agent.planner.model, "actor": agent.actor.model},
            "agent": {"running": agent.running, "task": agent.task, "steps": agent.steps}}


@app.get("/api/frame.jpg")
def frame():
    if not screen.live:
        raise HTTPException(404, "no live screen: start screen mirroring on the phone")
    return Response(screen.frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/detection")
async def detection():
    global detection_task
    if detection_task is not None and not detection_task.done():
        raise HTTPException(409, "Detection is busy; retry shortly")

    def infer():
        if not screen.live or not screen.frame:
            raise HTTPException(404, "No live screen")
        shot = screen.frame
        try:
            result = detector.detect(shot)
        except DetectionBusy as e:
            raise HTTPException(409, str(e)) from e
        except DetectionError as e:
            raise HTTPException(503, str(e)) from e
        if not screen.live:
            raise HTTPException(404, "No live screen")
        return JSONResponse({**result, "image": base64.b64encode(shot).decode("ascii")},
                            headers={"Cache-Control": "no-store"})

    detection_task = asyncio.create_task(asyncio.to_thread(infer))
    # Client cancellation cannot cancel PyTorch; keep the busy gate until it really finishes.
    detection_task.add_done_callback(lambda task: task.exception() if not task.cancelled() else None)
    return await asyncio.shield(detection_task)


@app.get("/api/steps/{index}.jpg")
def step_shot(index: int):
    if index not in agent.shots:
        raise HTTPException(404)
    return Response(agent.shots[index], media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


@app.post("/api/tap")
async def tap(p: Point):
    return await act(phone.tap(p.x, p.y))


@app.post("/api/double_tap")
async def double_tap(p: Point):
    return await act(phone.double_tap(p.x, p.y))


@app.post("/api/swipe")
async def swipe(s: Swipe):
    return await act(phone.swipe(s.x1, s.y1, s.x2, s.y2))


@app.post("/api/scroll")
async def scroll(s: Scroll):
    return await act(phone.scroll(s.x, s.y, s.lines))


@app.post("/api/type")
async def type_text(t: Text):
    return await act(phone.type(t.text))


@app.post("/api/key")
async def key(t: Text):
    return await act(phone.key(t.text))


@app.post("/api/home")
async def home():
    return await act(phone.go_home())


@app.post("/api/back")
async def back():
    return await act(phone.go_back())


@app.post("/api/raw")
async def raw(t: Text):
    """Debug only: send one protocol line to the board as-is."""
    if not DEBUG:
        raise HTTPException(404)
    return await act(device.send(t.text))


class CalibrationStart(BaseModel):
    manual: bool = False
    mode: Literal["default", "axis"] = "default"


@app.post("/api/calibrate/start")
async def calibrate_start(options: CalibrationStart | None = None):
    """Calibrate the pointer. {"auto": true}: done by itself; otherwise the user clicks the pointer next."""
    try:
        if options and options.mode == "axis":
            step = await phone.start_axis_calibration()
            return {"ok": True, "auto": False, "step": step, "span": phone.span}
        auto = await phone.start_calibration(manual=options.manual if options else False)
        return {"ok": True, "auto": auto, "span": phone.span}
    except (DeviceError, RuntimeError) as e:
        raise HTTPException(409, str(e)) from e


@app.post("/api/calibrate/finish")
async def calibrate_finish(p: Point):
    try:
        if phone._axis_samples is not None:
            step = await phone.finish_axis_calibration(p.x, p.y)
            return {"ok": True, "step": step, "span": phone.span}
        phone.finish_calibration(p.x, p.y)
        return {"ok": True, "span": phone.span}
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except (DeviceError, RuntimeError) as e:
        raise HTTPException(409, str(e)) from e


@app.post("/api/agent")
async def agent_start(t: Text):
    try:
        agent.start(t.text)
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from e
    return {"ok": True}


@app.post("/api/agent/stop")
async def agent_stop():
    """Emergency stop: cancel the agent and release the mouse button."""
    agent.stop()
    await asyncio.sleep(0.1)  # let a gesture in flight finish its own release
    return await act(phone.reset())


@app.post("/api/agent/clear")
def agent_clear():
    """Forget the last run (steps, screenshots, plan) so the page starts clean."""
    try:
        agent.clear()
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from e
    return {"ok": True}
