"""Password hashing with Argon2id (argon2-cffi, RFC 9106 parameters).

Only the hash is stored. A hash includes its own random salt and parameters,
so two equal passwords have different hashes, and hashes made with older
parameters can be recognised and upgraded at the next sign-in.
"""
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

MIN_LENGTH = 12
# Long enough for any passphrase, short enough that hashing it costs nothing extra.
MAX_LENGTH = 128

_hasher = PasswordHasher()
# Checked against when the email is unknown, so a wrong email takes as long as
# a wrong password and the response time does not tell which accounts exist.
_DUMMY_HASH = _hasher.hash("no account has this password")


def password_problem(password: str) -> str | None:
    """Why a new password is not acceptable, or None."""
    if len(password) < MIN_LENGTH:
        return f"Use at least {MIN_LENGTH} characters."
    if len(password) > MAX_LENGTH:
        return f"Use at most {MAX_LENGTH} characters."
    if not password.strip():
        return "The password can't be only spaces."
    return None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str | None, password: str) -> bool:
    """True if `password` matches `stored_hash`. With no hash (unknown account),
    the same work is done and the answer is False."""
    try:
        return _hasher.verify(stored_hash or _DUMMY_HASH, password) and stored_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    """True if the hash was made with weaker parameters than today's."""
    return _hasher.check_needs_rehash(stored_hash)
