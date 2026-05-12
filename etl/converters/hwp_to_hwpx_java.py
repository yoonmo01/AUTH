import subprocess
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tools" / "hwp2hwpx"
CLASSES_DIR = TOOL_DIR / "target" / "classes"
DEPS_GLOB = str(TOOL_DIR / "target" / "dependency" / "*")
JAR_PATH = TOOL_DIR / "target" / "hwp2hwpx-1.0.0.jar"


def is_valid_hwpx(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0 and zipfile.is_zipfile(path)


def convert(source: Path, target: Path, timeout: int = 60) -> None:
    if not JAR_PATH.exists():
        raise RuntimeError(f"missing hwp2hwpx jar: {JAR_PATH}")
    target.parent.mkdir(parents=True, exist_ok=True)
    classpath = f"{CLASSES_DIR};{JAR_PATH};{DEPS_GLOB}"
    result = subprocess.run(
        [
            "java",
            "-cp",
            classpath,
            "kr.dogfoot.hwp2hwpx.cli.Hwp2HwpxCli",
            str(source),
            str(target),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip()[:500])
    if not is_valid_hwpx(target):
        raise RuntimeError("Java hwp2hwpx produced an invalid hwpx")
