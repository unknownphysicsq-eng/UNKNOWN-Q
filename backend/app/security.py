import hashlib
import hmac
import json
import base64
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from app.config import settings

# Attempt to load passlib / bcrypt if installed, with a reliable PBKDF2/SHA256 fallback
try:
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    _HAS_PASSLIB = True
except ImportError:
    _HAS_PASSLIB = False

# Attempt to load pyjwt if installed
try:
    import jwt
    _HAS_PYJWT = True
except ImportError:
    _HAS_PYJWT = False


def hash_password(password: str) -> str:
    """
    Hashes a plain-text password using bcrypt (or standard PBKDF2-SHA256 fallback).
    """
    if _HAS_PASSLIB:
        return pwd_context.hash(password)
    
    # Secure SHA256-PBKDF2 fallback if passlib is not yet installed in host environment
    salt = "fairform_salt_2026".encode("utf-8")
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return f"pbkdf2_sha256${derived.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifies a plain-text password against a hashed password string.
    Supports bcrypt and PBKDF2-SHA256 formats.
    """
    if not hashed_password or not plain_password:
        return False

    if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$"):
        if _HAS_PASSLIB:
            try:
                return pwd_context.verify(plain_password, hashed_password)
            except Exception:
                return False
        # If passlib not present on host, attempt direct bcrypt if available
        try:
            import bcrypt
            return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
        except Exception:
            return False

    if hashed_password.startswith("pbkdf2_sha256$"):
        expected_hex = hashed_password.split("$", 1)[1]
        salt = "fairform_salt_2026".encode("utf-8")
        actual_hex = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, 100000).hex()
        return hmac.compare_digest(actual_hex, expected_hex)

    return False


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """
    Creates a signed JWT access token containing claims and expiration timestamp.
    """
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({
        "exp": int(expire.timestamp()),
        "iat": int(now.timestamp()),
    })

    if _HAS_PYJWT:
        return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

    # Compliant fallback HMAC-SHA256 JWT generation
    header = {"alg": "HS256", "typ": "JWT"}
    b64_header = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    b64_payload = base64.urlsafe_b64encode(json.dumps(to_encode).encode()).decode().rstrip("=")
    signing_input = f"{b64_header}.{b64_payload}".encode("utf-8")
    signature = hmac.new(settings.JWT_SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256).digest()
    b64_signature = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{b64_header}.{b64_payload}.{b64_signature}"


def decode_access_token(token: str) -> Dict[str, Any]:
    """
    Decodes and validates a signed JWT access token.
    Raises ValueError or jwt.PyJWTError if expired or signature is invalid.
    """
    if _HAS_PYJWT:
        return jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )

    # Compliant fallback HMAC-SHA256 JWT decoding
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid token format")
    b64_header, b64_payload, b64_sig = parts
    
    signing_input = f"{b64_header}.{b64_payload}".encode("utf-8")
    expected_sig = hmac.new(settings.JWT_SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256).digest()
    pad_b64_sig = b64_sig + "=" * (-len(b64_sig) % 4)
    actual_sig = base64.urlsafe_b64decode(pad_b64_sig)
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError("Invalid token signature")

    pad_b64_payload = b64_payload + "=" * (-len(b64_payload) % 4)
    payload_json = base64.urlsafe_b64decode(pad_b64_payload).decode("utf-8")
    payload = json.loads(payload_json)

    exp = payload.get("exp")
    if exp and exp < datetime.now(timezone.utc).timestamp():
        raise ValueError("Token has expired")

    return payload
