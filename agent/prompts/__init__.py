from pathlib import Path

import yaml


def load_prompt(name: str) -> dict:
    """agent/prompts/{name}.yaml 파일을 로드해서 반환합니다."""
    path = Path(__file__).parent / f"{name}.yaml"
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)
