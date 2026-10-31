import httpx
import pytest
from fastapi.testclient import TestClient

from manager.app import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / "servers.db", "test-admin-token")
    with TestClient(app) as client:
        yield client


AUTH = {"X-Admin-Token": "test-admin-token"}
SERVER = {"name": "手机 A", "host": "127.0.0.1", "port": 8890}


def test_shared_crud_auth_and_persistence(client):
    assert client.post("/api/servers", json=SERVER).status_code == 401
    created = client.post("/api/servers", headers=AUTH, json=SERVER)
    assert created.status_code == 201
    item = created.json()
    assert item["url"] == "http://127.0.0.1:8890"
    assert client.get("/api/servers").json() == [item]
    assert client.post("/api/servers", headers=AUTH, json=SERVER).status_code == 409
    changed = client.put(f'/api/servers/{item["id"]}', headers=AUTH, json={**SERVER, "name": "新名称"})
    assert changed.json()["name"] == "新名称"
    path = client.app.state.db_path
    with TestClient(create_app(path, "other-admin-token")) as second:
        assert second.get("/api/servers").json()[0]["name"] == "新名称"
    assert client.delete(f'/api/servers/{item["id"]}', headers=AUTH).status_code == 204
    assert client.get("/api/servers").json() == []


@pytest.mark.parametrize("patch", [
    {"host": "http://127.0.0.1/path"}, {"host": "user@127.0.0.1"}, {"host": "169.254.169.254"},
    {"host": "0.0.0.0"}, {"host": "224.0.0.1"}, {"port": 65536},
    {"port": 0}, {"name": " "}, {"host": "127.0.0.1?x=y"},
])
def test_rejects_invalid_targets(client, patch):
    assert client.post("/api/servers", headers=AUTH, json={**SERVER, **patch}).status_code == 422


def test_proxies_only_saved_targets_without_following_redirects(client):
    item = client.post("/api/servers", headers=AUTH, json=SERVER).json()
    calls = []

    async def handler(request):
        calls.append(str(request.url))
        if request.url.path == "/api/status":
            return httpx.Response(200, json={"device": True, "screen": True, "calibrated": False})
        return httpx.Response(302, headers={"Location": "http://169.254.169.254/"})

    original = client.app.state.http
    client.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    status = client.get(f'/api/servers/{item["id"]}/status')
    assert status.json()["device"] is True
    assert client.get(f'/api/servers/{item["id"]}/frame').status_code == 502
    assert len(calls) == 2
    assert client.get("/api/servers/missing/status").status_code == 404
    client.app.state.http = original


def test_accepts_servers_without_network_or_port_allowlists(client):
    response = client.post("/api/servers", headers=AUTH, json={**SERVER, "host": "10.0.30.51", "port": 9000})
    assert response.status_code == 201
    assert response.json()["url"] == "http://10.0.30.51:9000"


def test_console_routes_rewrite_and_isolate_devices(client):
    a = client.post("/api/servers", headers=AUTH, json=SERVER).json()
    b = client.post("/api/servers", headers=AUTH, json={**SERVER, "port": 8891}).json()
    calls = []

    async def handler(request):
        calls.append(request)
        if request.url.path == "/":
            return httpx.Response(200, text='<script src="/static/app.js"></script><button data-post="/api/home">')
        if request.url.path == "/static/app.js":
            return httpx.Response(200, text='fetch("/api/status"); img.src = `/api/steps/${index}.jpg?run=${runId}`;')
        return httpx.Response(409, json={"detail": "not calibrated"})

    original = client.app.state.http
    client.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        prefix = f'/servers/{a["id"]}'
        html = client.get(prefix + "/").text
        assert f'{prefix}/static/app.js' in html and f'{prefix}/api/home' in html
        script = client.get(prefix + "/static/app.js").text
        assert f'{prefix}/api/status' in script and f'{prefix}/api/steps/' in script
        for item in (a, b):
            response = client.post(f'/servers/{item["id"]}/api/tap', json={"x": 0.5, "y": 0.5},
                                   headers={"X-Admin-Token": "must-not-forward", "Cookie": "private=yes"})
            assert response.status_code == 409
            assert calls[-1].url.port == item["port"]
            assert "x-admin-token" not in calls[-1].headers and "cookie" not in calls[-1].headers
        response = client.post(prefix + "/api/double_tap", json={"x": 0.25, "y": 0.75})
        assert response.status_code == 409
        assert calls[-1].url.path == "/api/double_tap"
        assert calls[-1].url.port == a["port"]
        response = client.get(prefix + "/api/detection?123")
        assert response.status_code == 409
        assert calls[-1].url.path == "/api/detection"
        count = len(calls)
        assert client.post(prefix + "/api/raw", json={}).status_code == 404
        assert client.get(prefix + "/api/tap").status_code == 404
        assert client.post(prefix + "/api/type", content=b"x" * 65537).status_code == 413
        assert len(calls) == count
        assert client.get("/servers/missing/api/status").status_code == 404
    finally:
        client.app.state.http = original


def test_missing_admin_token_fails_closed(tmp_path):
    with pytest.raises(ValueError):
        create_app(tmp_path / "db", "")
