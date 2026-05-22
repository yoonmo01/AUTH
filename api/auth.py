# api/auth.py
# 역할: 사원/관리자 로그인 라우터
#   POST /auth/login → 역할에 따라 프로필 반환
#     사원: employee_id만으로 인증 → {role, employee_id, name, position, department}
#     관리자: admin_id + password(bcrypt) → {role, admin_id, name}
#     실패: 401
# 쓰는 테이블: employees, auth_admins

from fastapi import APIRouter, HTTPException

from api.db import query
from api.models import LoginRequest, esc

router = APIRouter()

_VALID_ROLES = {"employee", "admin"}


@router.post("/auth/login")
def login(body: LoginRequest):
    if body.role not in _VALID_ROLES:
        raise HTTPException(400, f"Invalid role. Valid: {sorted(_VALID_ROLES)}")

    if body.role == "employee":
        rows = query(
            f"SELECT employee_id, name, position, department "
            f"FROM employees WHERE employee_id = {esc(body.id)};"
        )
        if not rows:
            raise HTTPException(401, "Invalid credentials")
        emp = rows[0]
        return {
            "role": "employee",
            "employee_id": emp["employee_id"],
            "name": emp["name"],
            "position": emp["position"],
            "department": emp["department"],
        }

    # admin
    if not body.password:
        raise HTTPException(401, "Invalid credentials")
    rows = query(
        f"SELECT admin_id, name FROM auth_admins "
        f"WHERE admin_id = {esc(body.id)} "
        f"AND password_hash = crypt({esc(body.password)}, password_hash);"
    )
    if not rows:
        raise HTTPException(401, "Invalid credentials")
    adm = rows[0]
    return {
        "role": "admin",
        "admin_id": adm["admin_id"],
        "name": adm["name"],
    }
