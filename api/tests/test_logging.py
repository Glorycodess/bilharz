"""IP addresses are held in memory for the rate limits only and never logged:
the Space starts uvicorn without its access log, and the app's own log lines
never include a client address."""
import ast
import logging

from fastapi.testclient import TestClient

from bilharz.settings import REPO_DIR

SPACE_APP = REPO_DIR / "deploy" / "space" / "app.py"
# The address the test client reports for every request, as a visitor's IP would be.
CLIENT = "203.0.113.77"


def test_the_space_starts_uvicorn_without_an_access_log():
    """deploy/space/app.py needs the Space's packages to import, so it is read, not run."""
    tree = ast.parse(SPACE_APP.read_text())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "run"
        and getattr(node.func.value, "id", None) == "uvicorn"
    ]
    assert len(calls) == 1
    keywords = {k.arg: k.value for k in calls[0].keywords}
    assert isinstance(keywords.get("access_log"), ast.Constant) and keywords["access_log"].value is False


def test_no_log_line_contains_a_client_address(make_client, caplog):
    app = make_client().app
    browser = TestClient(app, base_url="https://testserver", headers={"Origin": "https://testserver"},
                         client=(CLIENT, 50000))
    with caplog.at_level(logging.DEBUG):
        for _ in range(6):  # wrong passwords, up to the per-account limit
            browser.post("/api/auth/signin", json={"email": "ada@example.org", "password": "wrong password!"})
        browser.post("/api/auth/signup", json={"name": "Ada", "email": "ada@example.org", "password": "correct horse battery"})
        browser.post("/api/admin/claim", headers={"X-Admin-Token": "a guess"})
        browser.post("/api/auth/reset", json={"token": "guess", "password": "correct horse battery"})
        browser.post("/api/auth/signup", json={"name": "Ada", "email": "x@example.org", "password": "x"},
                     headers={"Origin": "https://evil.example"})
        browser.get("/api/samples/DT99")
        browser.post("/api/analyse", content=b"not multipart", headers={"Content-Type": "text/plain"})
    # The address was seen: the per-address limit is counting it, in memory.
    assert app.state.limits.signin_ip._hits.get(CLIENT)
    logged = "\n".join(f"{r.name} {r.getMessage()} {r.args}" for r in caplog.records)
    assert caplog.records, "nothing was logged at all, so the check proves nothing"
    assert CLIENT not in logged
