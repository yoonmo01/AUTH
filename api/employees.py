# api/employees.py
# 역할: 직원 프로필 조회 라우터
#   GET /employees                  → 전체 직원 목록
#   GET /employees/{employee_id}    → 직원 상세 or 404
# 쓰는 테이블: employees

from fastapi import APIRouter, HTTPException

from api.db import query
from api.models import esc

router = APIRouter()


@router.get("/employees")
def list_employees():
    return query("SELECT employee_id, name, position, department FROM employees ORDER BY employee_id;")


@router.get("/employees/{employee_id}")
def get_employee(employee_id: str):
    rows = query(
        f"SELECT employee_id, name, position, department "
        f"FROM employees WHERE employee_id = {esc(employee_id)};"
    )
    if not rows:
        raise HTTPException(404, "Employee not found")
    return rows[0]
