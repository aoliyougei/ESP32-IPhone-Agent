"""Shared inventory and bounded, read-only proxies for legacy iPhone servers."""
import asyncio
import hmac
import ipaddress
import os
import re
import socket
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


class Server(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)


def create_app(db_path, admin_token):
    if not admin_token:
        raise ValueError("MANAGER_ADMIN_TOKEN must be configured")
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT, host TEXT, port INTEGER, "
                   "UNIQUE(host, port))")

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(timeout=5, follow_redirects=False, trust_env=False) as http:
            app.state.http = http
            yield

    app = FastAPI(lifespan=lifespan)
    app.state.db_path = db_path
    static = Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=static), name="static")

    def admin(x_admin_token: str = Header(default="")):
        if not hmac.compare_digest(x_admin_token.encode(), admin_token.encode()):
            raise HTTPException(401, "Administrator token required")

    def record(row):
        item = dict(zip(("id", "name", "host", "port"), row))
        host = f'[{item["host"]}]' if ":" in item["host"] else item["host"]
        return {**item, "url": f'http://{host}:{item["port"]}'}

    def get(server_id):
        with sqlite3.connect(db_path) as db:
            row = db.execute("SELECT id,name,host,port FROM servers WHERE id=?", (server_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Server not found")
        return record(row)

    async def target(host, port):
        # Resolve on every request and connect to the checked numeric address: no DNS rebinding window.
        try:
            address = ipaddress.ip_address(host)
            addresses = [address]
        except ValueError:
            if not re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?", host):
                raise HTTPException(422, "Use an IP address or hostname without scheme/path") from None
            try:
                entries = await asyncio.wait_for(
                    asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM), 3)
                addresses = list(dict.fromkeys(ipaddress.ip_address(entry[4][0]) for entry in entries))
            except (OSError, asyncio.TimeoutError, ValueError):
                raise HTTPException(422, "Cannot resolve hostname") from None
        if not addresses or any(
            address.is_link_local or address.is_multicast or address.is_unspecified for address in addresses
        ):
            raise HTTPException(422, "Link-local, multicast and unspecified addresses are not supported")
        address = str(addresses[0])
        return f"http://[{address}]:{port}" if ":" in address else f"http://{address}:{port}"

    async def save(value, server_id=None):
        name, host = value.name.strip(), value.host.strip().lower()
        if not name:
            raise HTTPException(422, "Name cannot be blank")
        await target(host, value.port)
        if server_id:
            get(server_id)
        server_id = server_id or uuid4().hex
        try:
            with sqlite3.connect(db_path) as db:
                db.execute("INSERT INTO servers VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                           "name=excluded.name,host=excluded.host,port=excluded.port",
                           (server_id, name, host, value.port))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "This host and port already exist") from None
        return get(server_id)

    async def proxy(server_id, image=False):
        item = get(server_id)
        origin = await target(item["host"], item["port"])
        path = "/api/frame.jpg" if image else "/api/status"
        try:
            async with app.state.http.stream("GET", origin + path) as response:
                if response.status_code != 200:
                    raise HTTPException(502, "Upstream unavailable or not mirroring")
                if image and not response.headers.get("content-type", "").lower().startswith("image/jpeg"):
                    raise HTTPException(502, "Upstream did not return JPEG")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > (8 * 1024 * 1024 if image else 256 * 1024):
                        raise HTTPException(502, "Upstream response too large")
            if image:
                if data[:2] != b"\xff\xd8":
                    raise HTTPException(502, "Invalid JPEG")
                return Response(bytes(data), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
            # Only expose the fields needed by the overview, not tasks, prompts or traces.
            import json
            status = json.loads(data)
            return {key: status.get(key) is True for key in ("device", "screen", "calibrated")} | {
                "running": status.get("agent", {}).get("running") is True}
        except (httpx.HTTPError, ValueError, AttributeError, TypeError):
            raise HTTPException(502, "Server unreachable or invalid response") from None

    @app.api_route("/servers/{server_id}/{path:path}", methods=["GET", "POST"])
    async def console(server_id: str, path: str, request: Request):
        static_paths = {"static/style.css", "static/app.js", "static/i18n.js"}
        actions = {"tap", "double_tap", "swipe", "scroll", "type", "key", "home", "back",
                   "calibrate/start", "calibrate/finish", "agent", "agent/stop", "agent/clear"}
        allowed = (path in {"", "api/status", "api/frame.jpg"} | static_paths
                   or re.fullmatch(r"api/steps/[0-9]+\.jpg", path)) if request.method == "GET" else (
                       path in {"api/" + action for action in actions})
        if not allowed:
            raise HTTPException(404, "Unsupported console route")
        item = get(server_id)
        origin = await target(item["host"], item["port"])
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 64 * 1024:
                raise HTTPException(413, "Request too large")
        try:
            async with app.state.http.stream(request.method, origin + "/" + path,
                                             params=request.query_params, content=bytes(body),
                                             headers={"Content-Type": "application/json"}, timeout=60) as upstream:
                if 300 <= upstream.status_code < 400:
                    raise HTTPException(502, "Upstream redirects are not supported")
                data = bytearray()
                async for chunk in upstream.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 8 * 1024 * 1024:
                        raise HTTPException(502, "Upstream response too large")
                content_type = upstream.headers.get("content-type", "application/octet-stream")
                if upstream.status_code == 200 and path in {"", "static/app.js"}:
                    prefix = f"/servers/{server_id}"
                    text = data.decode("utf-8")
                    # Legacy console uses root-relative URLs in HTML and JavaScript literals.
                    text = re.sub(r'''(["'`])/(api|static)/''',
                                  lambda match: match[1] + prefix + "/" + match[2] + "/", text)
                    data = text.encode("utf-8")
                return Response(bytes(data), status_code=upstream.status_code,
                                headers={"Content-Type": content_type, "Cache-Control": "no-store",
                                         "Content-Security-Policy": "frame-ancestors 'self'"})
        except (httpx.HTTPError, UnicodeError):
            raise HTTPException(502, "Server unreachable or invalid response") from None

    @app.get("/")
    def index():
        return FileResponse(static / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/api/servers")
    def servers():
        with sqlite3.connect(db_path) as db:
            return [record(row) for row in db.execute("SELECT id,name,host,port FROM servers ORDER BY rowid")]

    @app.post("/api/servers", status_code=201, dependencies=[Depends(admin)])
    async def add(value: Server):
        return await save(value)

    @app.put("/api/servers/{server_id}", dependencies=[Depends(admin)])
    async def edit(server_id: str, value: Server):
        return await save(value, server_id)

    @app.delete("/api/servers/{server_id}", status_code=204, dependencies=[Depends(admin)])
    def delete(server_id: str):
        get(server_id)
        with sqlite3.connect(db_path) as db:
            db.execute("DELETE FROM servers WHERE id=?", (server_id,))
        return Response(status_code=204)

    @app.get("/api/servers/{server_id}/status")
    async def status(server_id: str):
        return await proxy(server_id)

    @app.get("/api/servers/{server_id}/frame")
    async def frame(server_id: str):
        return await proxy(server_id, True)

    return app


def from_env():
    return create_app(os.environ.get("MANAGER_DB", "/data/servers.db"),
                      os.environ.get("MANAGER_ADMIN_TOKEN", ""))
