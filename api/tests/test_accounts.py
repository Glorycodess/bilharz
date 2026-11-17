"""Reviewer accounts, tested through real sign-ins: hashing, sessions, rate
limits, approval, the reviewer taken from the session, the Origin check and
admin-only actions. Each browser is a TestClient on https with its own cookies."""
import csv
import io
import json

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from bilharz.accounts import AccountStore
from bilharz.passwords import needs_rehash
from bilharz.sessions import COOKIE_SECURE, IDLE_SECONDS, MAX_SECONDS, token_hash

from .conftest import ADMIN_TOKEN

SITE = "https://testserver"
PASSWORD = "correct horse battery"
ADMIN = {"X-Admin-Token": ADMIN_TOKEN}


def browser(app, origin=SITE):
    """A browser on the site: https, its own cookie jar, and the Origin header browsers send."""
    return TestClient(app, base_url=SITE, headers={"Origin": origin} if origin else {})


@pytest.fixture()
def app(make_client):
    return make_client().app


def sign_up(b, name="Ada Obi", email="ada@example.org", password=PASSWORD):
    return b.post("/api/auth/signup", json={"name": name, "email": email, "password": password})


def sign_in(b, email="ada@example.org", password=PASSWORD):
    return b.post("/api/auth/signin", json={"email": email, "password": password})


def make_admin(app, name="Admin Person", email="admin@example.org"):
    """A browser signed in as an approved admin, made with the admin token."""
    b = browser(app)
    assert sign_up(b, name=name, email=email).status_code == 201
    assert b.post("/api/admin/claim", headers=ADMIN).status_code == 200
    return b


def make_reviewer(app, admin, name="Ada Obi", email="ada@example.org"):
    """A browser signed in as an approved reviewer."""
    b = browser(app)
    account = sign_up(b, name=name, email=email).json()
    assert admin.post(f"/api/admin/accounts/{account['id']}/approve").status_code == 200
    return b, account


def accounts_file(app):
    return app.state.accounts.path.read_text()


def session_cookie(b):
    return b.cookies.get(COOKIE_SECURE)


# Hashing -----------------------------------------------------------------------


def test_only_an_argon2id_hash_of_the_password_is_stored(app):
    sign_up(browser(app))
    sign_up(browser(app), name="Kofi", email="kofi@example.org")
    text = accounts_file(app)
    assert PASSWORD not in text
    hashes = [json.loads(line)["password_hash"] for line in text.splitlines()]
    assert all(h.startswith("$argon2id$") for h in hashes)
    assert hashes[0] != hashes[1]  # the same password, salted differently


def test_a_hash_made_with_weaker_settings_is_upgraded_at_sign_in(app):
    account = sign_up(browser(app)).json()
    weak = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash(PASSWORD)
    app.state.accounts.update(account["id"], password_hash=weak)
    assert sign_in(browser(app)).status_code == 200
    upgraded = app.state.accounts.get(account["id"]).password_hash
    assert upgraded != weak and not needs_rehash(upgraded)


@pytest.mark.parametrize(
    "body, message",
    [
        ({"name": "Ada", "email": "ada@example.org", "password": "short"}, "Use at least 12 characters."),
        ({"name": "Ada", "email": "ada@example.org", "password": "x" * 129}, "Use at most 128 characters."),
        ({"name": "Ada", "email": "ada@example.org", "password": " " * 12}, "The password can't be only spaces."),
        ({"name": "  ", "email": "ada@example.org", "password": PASSWORD}, "Enter your name."),
        ({"name": "Ada\x00", "email": "ada@example.org", "password": PASSWORD}, "The name contains characters that aren't allowed."),
        ({"name": "Ada", "email": "not-an-email", "password": PASSWORD}, "Enter a valid email address."),
    ],
)
def test_sign_up_checks_name_email_and_password(app, body, message):
    r = browser(app).post("/api/auth/signup", json=body)
    assert r.status_code == 422 and r.json() == {"detail": message}
    assert len(app.state.accounts) == 0


def test_an_email_can_be_used_once_whatever_its_case(app):
    assert sign_up(browser(app)).status_code == 201
    again = sign_up(browser(app), email="  ADA@Example.org ")
    assert again.status_code == 409
    assert sign_in(browser(app), email="Ada@EXAMPLE.org").status_code == 200


def test_sign_up_takes_no_role_or_status(app):
    r = browser(app).post("/api/auth/signup", json={"name": "Ada", "email": "a@example.org", "password": PASSWORD,
                                                    "role": "admin", "status": "approved"})
    assert r.status_code == 422 and len(app.state.accounts) == 0


# Sessions ----------------------------------------------------------------------


def test_the_session_cookie_is_secure_http_only_lax_and_host_only(app):
    r = sign_up(browser(app))
    assert r.status_code == 201 and r.json()["status"] == "pending" and r.json()["role"] == "reviewer"
    cookie = r.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE_SECURE}=")
    attributes = {part.strip().split("=")[0].lower() for part in cookie.split(";")[1:]}
    assert {"httponly", "secure", "samesite", "path", "max-age"} <= attributes and "domain" not in attributes
    assert "samesite=lax" in cookie.lower() and "path=/" in cookie.lower() and f"max-age={MAX_SECONDS}" in cookie.lower()


def test_the_server_keeps_only_a_hash_of_the_session_token(app):
    b = browser(app)
    sign_up(b)
    token = session_cookie(b)
    assert token and len(token) >= 43  # 32 random bytes
    assert token not in app.state.sessions._sessions and token_hash(token) in app.state.sessions._sessions
    assert token not in accounts_file(app)


def test_me_shows_the_signed_in_account_and_sign_out_ends_the_session(app):
    b = browser(app)
    sign_up(b)
    assert b.get("/api/auth/me").json()["account"]["email"] == "ada@example.org"
    stolen = session_cookie(b)
    assert b.post("/api/auth/signout").status_code == 204
    assert b.get("/api/auth/me").json() == {"account": None}
    # The old cookie, sent again, no longer works.
    replay = browser(app)
    replay.cookies.set(COOKIE_SECURE, stolen)
    assert replay.get("/api/auth/me").json() == {"account": None}


def test_signing_in_replaces_the_session_token(app):
    b = browser(app)
    sign_up(b)
    before = session_cookie(b)
    sign_in(b)
    after = session_cookie(b)
    assert after != before
    old = browser(app)
    old.cookies.set(COOKIE_SECURE, before)
    assert old.get("/api/auth/me").json() == {"account": None}


def test_a_session_ends_after_8_hours_without_a_request(app):
    b = browser(app)
    sign_up(b)
    app.state.clock.advance(IDLE_SECONDS - 60)
    assert b.get("/api/auth/me").json()["account"] is not None  # a request restarts the idle clock
    app.state.clock.advance(IDLE_SECONDS - 60)
    assert b.get("/api/auth/me").json()["account"] is not None
    app.state.clock.advance(IDLE_SECONDS + 1)
    assert b.get("/api/auth/me").json() == {"account": None}


def test_a_session_ends_7_days_after_sign_in_even_when_in_use(app):
    b = browser(app)
    sign_up(b)
    step = IDLE_SECONDS - 60  # never idle long enough to end it
    while app.state.clock.offset + step <= MAX_SECONDS:
        app.state.clock.advance(step)
        assert b.get("/api/auth/me").json()["account"] is not None
    app.state.clock.advance(step)  # now past 7 days since sign-in
    assert b.get("/api/auth/me").json() == {"account": None}


def test_sessions_do_not_survive_a_restart_but_accounts_do(app, make_client):
    b = browser(app)
    sign_up(b)
    restarted = make_client().app  # the same storage, a new server
    again = browser(restarted)
    again.cookies.set(COOKIE_SECURE, session_cookie(b))
    assert again.get("/api/auth/me").json() == {"account": None}
    assert sign_in(again).status_code == 200


def test_a_plain_http_development_server_uses_a_non_secure_cookie(make_client):
    app = make_client(cookie_secure=False).app
    b = TestClient(app, headers={"Origin": "http://testserver"})
    r = sign_up(b)
    assert r.headers["set-cookie"].startswith("bilharz_session=") and "secure" not in r.headers["set-cookie"].lower()
    assert b.get("/api/auth/me").json()["account"] is not None


# Rate limiting -----------------------------------------------------------------


def test_five_wrong_passwords_lock_the_account_for_15_minutes(app):
    sign_up(browser(app))
    b = browser(app)
    for _ in range(5):
        assert sign_in(b, password="wrong password!").status_code == 401
    locked = sign_in(b)  # even the right password waits
    assert locked.status_code == 429 and locked.json() == {"detail": "Too many attempts. Wait 15 minutes and try again."}
    sign_up(browser(app), name="Kofi", email="kofi@example.org")
    assert sign_in(browser(app), email="kofi@example.org").status_code == 200  # other accounts are not affected
    app.state.clock.advance(15 * 60)
    assert sign_in(b).status_code == 200


def test_a_successful_sign_in_resets_the_count(app):
    sign_up(browser(app))
    b = browser(app)
    for _ in range(4):
        sign_in(b, password="wrong password!")
    assert sign_in(b).status_code == 200
    for _ in range(4):
        assert sign_in(b, password="wrong password!").status_code == 401


def test_twenty_wrong_passwords_from_one_address_block_it(app):
    for i in range(5):
        for _ in range(4):  # under each account's limit
            assert sign_in(browser(app), email=f"guess{i}@example.org", password="wrong password!").status_code == 401
    assert sign_in(browser(app), email="someone@example.org", password="wrong password!").status_code == 429


def test_an_unknown_email_and_a_wrong_password_get_the_same_answer(app):
    sign_up(browser(app))
    wrong_password = sign_in(browser(app), password="wrong password!")
    unknown_email = sign_in(browser(app), email="nobody@example.org")
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json() == {"detail": "The email or password is wrong."}


def test_sign_ups_from_one_address_are_limited(app):
    for i in range(5):
        assert sign_up(browser(app), email=f"user{i}@example.org").status_code == 201
    assert sign_up(browser(app), email="user9@example.org").status_code == 429
    app.state.clock.advance(60 * 60)
    assert sign_up(browser(app), email="user9@example.org").status_code == 201


def test_wrong_admin_tokens_are_limited_per_account(app):
    b = browser(app)
    sign_up(b)
    for _ in range(5):
        assert b.post("/api/admin/claim", headers={"X-Admin-Token": "guess"}).status_code == 403
    assert b.post("/api/admin/claim", headers=ADMIN).status_code == 429
    assert app.state.accounts.get(1).role == "reviewer"


def test_wrong_reset_tokens_are_limited(app):
    b = browser(app)
    for _ in range(10):
        assert b.post("/api/auth/reset", json={"token": "guess", "password": PASSWORD}).status_code == 400
    assert b.post("/api/auth/reset", json={"token": "guess", "password": PASSWORD}).status_code == 429


# Approval: pending accounts cannot review --------------------------------------


def test_a_pending_account_can_sign_in_but_not_review(app):
    b = browser(app)
    sign_up(b)
    assert b.get("/api/auth/me").json()["account"]["status"] == "pending"
    r = b.post("/api/reviews/DT40", json={"verdict": "healthy"})
    assert r.status_code == 403 and r.json() == {"detail": "Your account is waiting for an admin to approve it."}
    assert b.get("/api/reviews").status_code == 403
    assert b.get("/api/reviews").status_code == 403


def test_once_approved_the_account_reviews_under_its_own_name(app):
    admin = make_admin(app)
    b, account = make_reviewer(app, admin)
    saved = b.post("/api/reviews/DT40", json={"verdict": "infected", "note": "Spine on tile 1"})
    assert saved.status_code == 201 and saved.json()["reviewer_name"] == "Ada Obi"
    stored = app.state.reviews.all()[0]
    assert (stored["reviewer_id"], stored["reviewer_name"]) == (account["id"], "Ada Obi")
    assert b.get("/api/samples/DT40").json()["review"]["note"] == "Spine on tile 1"
    # Not signed in: the verdict is public, the note and the name are not.
    public = browser(app).get("/api/samples/DT40").json()["review"]
    assert public["verdict"] == "infected" and public["note"] is None and public["reviewer_name"] is None


def test_the_reviewer_cannot_be_sent_in_the_request(app):
    admin = make_admin(app)
    b, account = make_reviewer(app, admin)
    for extra in ({"reviewer_id": 99}, {"reviewer_name": "Someone else"}, {"tester_code": "T1"}):
        assert b.post("/api/reviews/DT40", json={"verdict": "healthy", **extra}).status_code == 422
    assert app.state.reviews.all() == []


def test_a_disabled_account_is_signed_out_at_once_and_cannot_sign_in(app):
    admin = make_admin(app)
    b, account = make_reviewer(app, admin)
    assert b.get("/api/auth/me").json()["account"] is not None
    assert admin.post(f"/api/admin/accounts/{account['id']}/disable").json()["status"] == "disabled"
    assert b.get("/api/auth/me").json() == {"account": None}
    assert b.post("/api/reviews/DT40", json={"verdict": "healthy"}).status_code == 401
    r = sign_in(browser(app))
    assert r.status_code == 403 and r.json() == {"detail": "This account has been disabled. Ask an admin."}
    assert sign_in(browser(app), password="wrong password!").status_code == 401  # no hint without the password
    assert admin.post(f"/api/admin/accounts/{account['id']}/approve").status_code == 200
    assert sign_in(browser(app)).status_code == 200


def test_reviews_keep_the_name_of_a_disabled_reviewer(app):
    admin = make_admin(app)
    b, account = make_reviewer(app, admin)
    b.post("/api/reviews/DT40", json={"verdict": "healthy"})
    admin.post(f"/api/admin/accounts/{account['id']}/disable")
    assert admin.get("/api/reviews").json()[0]["reviewer_name"] == "Ada Obi"


# The Origin check (cross-site request forgery) ---------------------------------


def test_a_request_from_another_site_is_refused(app):
    b = browser(app)
    sign_up(b)
    admin = make_admin(app)
    for origin in ("https://evil.example", "null", "https://testserver.evil.example"):
        r = b.post("/api/auth/signout", headers={"Origin": origin})
        assert r.status_code == 403 and r.json() == {"detail": "This request came from another site and was refused."}
        assert admin.post("/api/admin/accounts/1/approve", headers={"Origin": origin}).status_code == 403
    assert app.state.accounts.get(1).status == "pending"
    assert b.get("/api/auth/me").json()["account"] is not None  # still signed in


def test_a_request_with_the_session_cookie_but_no_origin_is_refused(app):
    b = browser(app)
    sign_up(b)
    no_origin = browser(app, origin=None)
    no_origin.cookies.set(COOKIE_SECURE, session_cookie(b))
    assert no_origin.post("/api/auth/signout").status_code == 403
    assert no_origin.get("/api/auth/me").json()["account"] is not None  # reading is not affected


def test_the_site_itself_and_the_allowed_origins_pass(app):
    assert sign_up(browser(app)).status_code == 201
    assert sign_up(browser(app, origin="http://localhost:5173"), email="kofi@example.org").status_code == 201


def test_scripts_without_a_cookie_still_work(app):
    """No cookie, nothing to borrow: a script (no Origin header) can still sign in."""
    sign_up(browser(app))
    assert sign_in(browser(app, origin=None)).status_code == 200


def test_a_cross_site_form_cannot_create_an_account(app):
    assert sign_up(browser(app, origin="https://evil.example")).status_code == 403
    assert len(app.state.accounts) == 0


# Admin-only actions ------------------------------------------------------------

ADMIN_ACTIONS = [
    ("get", "/api/admin/accounts", None),
    ("post", "/api/admin/accounts/1/approve", None),
    ("post", "/api/admin/accounts/1/disable", None),
    ("post", "/api/admin/accounts/1/role", {"role": "admin"}),
    ("post", "/api/admin/accounts/1/reset-link", None),
]


@pytest.mark.parametrize("method, path, body", ADMIN_ACTIONS)
def test_admin_actions_need_a_signed_in_admin(app, method, path, body):
    target = browser(app)
    sign_up(target)
    assert getattr(browser(app), method)(path, **({"json": body} if body else {})).status_code == 401
    assert getattr(target, method)(path, **({"json": body} if body else {})).status_code == 403  # pending
    admin = make_admin(app)
    reviewer, _ = make_reviewer(app, admin, name="Kofi", email="kofi@example.org")
    r = getattr(reviewer, method)(path, **({"json": body} if body else {}))  # approved, not admin
    assert r.status_code == 403 and r.json() == {"detail": "Only an admin can do this."}
    # The admin token is not a way into account management: only the claim takes it.
    assert getattr(browser(app), method)(path, headers=ADMIN, **({"json": body} if body else {})).status_code == 401
    assert app.state.accounts.get(1).status == "pending" and app.state.accounts.get(1).role == "reviewer"


def test_the_first_admin_is_made_with_the_admin_token(app):
    b = browser(app)
    assert b.post("/api/admin/claim", headers=ADMIN).status_code == 401  # signed in first
    sign_up(b)
    assert b.post("/api/admin/claim", headers={"X-Admin-Token": "wrong"}).status_code == 403
    r = b.post("/api/admin/claim", headers=ADMIN)
    assert r.status_code == 200 and r.json()["role"] == "admin" and r.json()["status"] == "approved"
    assert [a["email"] for a in b.get("/api/admin/accounts").json()] == ["ada@example.org"]


def test_claiming_admin_is_off_without_an_admin_token(make_client):
    app = make_client(admin_token=None).app
    b = browser(app)
    sign_up(b)
    r = b.post("/api/admin/claim", headers={"X-Admin-Token": ""})
    assert r.status_code == 403 and "no admin token is set" in r.json()["detail"]


def test_an_admin_approves_changes_roles_and_cannot_lock_themselves_out(app):
    admin = make_admin(app)
    b = browser(app)
    kofi = sign_up(b, name="Kofi", email="kofi@example.org").json()
    listed = {a["email"]: a for a in admin.get("/api/admin/accounts").json()}
    assert listed["kofi@example.org"]["status"] == "pending"
    assert admin.post(f"/api/admin/accounts/{kofi['id']}/approve").json()["status"] == "approved"
    assert admin.post(f"/api/admin/accounts/{kofi['id']}/role", json={"role": "admin"}).json()["role"] == "admin"
    assert b.get("/api/admin/accounts").status_code == 200  # the new role applies at once
    assert admin.post(f"/api/admin/accounts/{kofi['id']}/role", json={"role": "boss"}).status_code == 422
    me = admin.get("/api/auth/me").json()["account"]["id"]
    assert admin.post(f"/api/admin/accounts/{me}/disable").status_code == 409
    assert admin.post(f"/api/admin/accounts/{me}/role", json={"role": "reviewer"}).status_code == 409
    assert admin.post("/api/admin/accounts/999/approve").status_code == 404


def test_only_admins_see_other_accounts_emails(app):
    admin = make_admin(app)
    b, _ = make_reviewer(app, admin)
    b.post("/api/reviews/DT40", json={"verdict": "healthy"})
    for path in ("/api/reviews", "/api/reviews?view=all", "/api/samples/DT40", "/api/auth/me"):
        assert "admin@example.org" not in b.get(path).text


def test_an_admin_session_exports_and_deletes_reviews_without_the_token(app):
    admin = make_admin(app)
    b, _ = make_reviewer(app, admin)
    b.post("/api/reviews/DT40", json={"verdict": "healthy"})
    assert b.get("/api/reviews.csv").status_code == 403  # a reviewer is not enough
    assert b.delete("/api/reviews").status_code == 403
    rows = list(csv.reader(io.StringIO(admin.get("/api/reviews.csv").text)))
    assert rows[1][-1] == "Ada Obi"
    assert browser(app).get("/api/reviews.csv", headers=ADMIN).status_code == 200  # the token still works
    assert admin.delete("/api/reviews").json() == {"deleted": 1}


# Reset links -------------------------------------------------------------------


def reset_link(admin, account_id):
    r = admin.post(f"/api/admin/accounts/{account_id}/reset-link")
    assert r.status_code == 200
    return r.json()


def token_of(link):
    return link["url"].split("#token=", 1)[1]


def test_a_reset_link_sets_a_new_password_once_and_signs_out_everywhere(app):
    admin = make_admin(app)
    b, account = make_reviewer(app, admin)
    link = reset_link(admin, account["id"])
    assert link["url"].startswith(f"{SITE}/reset-password#token=")
    token = token_of(link)
    assert token not in accounts_file(app)  # only its hash is stored
    assert admin.get("/api/admin/accounts").json()[1]["reset_link_active"] is True

    new = "a brand new passphrase"
    assert browser(app).post("/api/auth/reset", json={"token": token, "password": "short"}).status_code == 422
    assert browser(app).post("/api/auth/reset", json={"token": token, "password": new}).status_code == 204
    assert b.get("/api/auth/me").json() == {"account": None}  # every session ended
    assert sign_in(browser(app)).status_code == 401
    assert sign_in(browser(app), password=new).status_code == 200
    again = browser(app).post("/api/auth/reset", json={"token": token, "password": "another new passphrase"})
    assert again.status_code == 400  # it works once
    assert admin.get("/api/admin/accounts").json()[1]["reset_link_active"] is False


def test_a_reset_link_expires_after_an_hour_and_a_new_one_replaces_it(app):
    admin = make_admin(app)
    _, account = make_reviewer(app, admin)
    first = token_of(reset_link(admin, account["id"]))
    second = token_of(reset_link(admin, account["id"]))
    assert browser(app).post("/api/auth/reset", json={"token": first, "password": PASSWORD + "!"}).status_code == 400
    app.state.clock.advance(60 * 60 + 1)
    assert browser(app).post("/api/auth/reset", json={"token": second, "password": PASSWORD + "!"}).status_code == 400


def test_a_disabled_account_gets_no_reset_link_and_disabling_cancels_one(app):
    admin = make_admin(app)
    _, account = make_reviewer(app, admin)
    token = token_of(reset_link(admin, account["id"]))
    admin.post(f"/api/admin/accounts/{account['id']}/disable")
    assert browser(app).post("/api/auth/reset", json={"token": token, "password": PASSWORD + "!"}).status_code == 400
    assert admin.post(f"/api/admin/accounts/{account['id']}/reset-link").status_code == 409


# Storage -----------------------------------------------------------------------


def test_account_responses_are_never_cached(app):
    r = sign_up(browser(app))
    assert r.headers["cache-control"] == "no-store"
    assert browser(app).get("/api/auth/me").headers["cache-control"] == "no-store"


def test_accounts_that_cannot_be_saved_are_refused_not_lost(app, monkeypatch):
    def fail(path, data):
        raise OSError("disk full")

    monkeypatch.setattr(AccountStore, "_replace", staticmethod(fail))
    r = sign_up(browser(app))
    assert r.status_code == 500 and len(app.state.accounts) == 0


def test_an_accounts_file_with_an_unreadable_line_is_never_overwritten(app, make_client):
    sign_up(browser(app))
    path = app.state.accounts.path
    path.write_text(path.read_text() + "not json\n")
    before = path.read_text()
    restarted = make_client().app
    assert restarted.state.accounts.writable is False
    assert sign_in(browser(restarted)).status_code == 200  # existing accounts still sign in
    assert sign_up(browser(restarted), email="kofi@example.org").status_code == 500
    assert browser(restarted).get("/api/health").json()["accounts_writable"] is False
    assert path.read_text() == before


def test_the_accounts_file_holds_no_password_or_token(app):
    admin = make_admin(app)
    _, account = make_reviewer(app, admin)
    token = token_of(reset_link(admin, account["id"]))
    text = accounts_file(app)
    assert PASSWORD not in text and token not in text
    row = json.loads(text.splitlines()[1])
    assert set(row) >= {"name", "email", "password_hash", "role", "status", "created_at"}
    assert row["reset_token_hash"] == token_hash(token)


def test_accounts_live_next_to_the_reviews_journal_when_one_is_set(make_client, tmp_path):
    app = make_client(reviews_dir=tmp_path / "bucket", accounts_dir=tmp_path / "bucket").app
    sign_up(browser(app))
    assert (tmp_path / "bucket" / "accounts.jsonl").exists()
