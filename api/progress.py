# api/progress.py
# 역할: 에이전트 파이프라인 실행 진행 이벤트 큐 레지스트리
#   - register(session_id): 새 세션용 큐 생성
#   - emit(session_id, event): 큐에 이벤트 push (스레드 안전)
#   - get_queue(session_id): SSE 엔드포인트가 큐 참조를 가져감
#   - cleanup(session_id): 큐 제거
import queue
import threading
from typing import Optional

_lock = threading.Lock()
_queues: dict[str, queue.Queue] = {}


def register(session_id: str) -> None:
    with _lock:
        _queues[session_id] = queue.Queue()


def emit(session_id: str, event: dict) -> None:
    with _lock:
        q = _queues.get(session_id)
    if q:
        q.put_nowait(event)


def get_queue(session_id: str) -> Optional[queue.Queue]:
    with _lock:
        return _queues.get(session_id)


def cleanup(session_id: str) -> None:
    with _lock:
        _queues.pop(session_id, None)
