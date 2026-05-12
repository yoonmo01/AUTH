import subprocess
import sys
import zipfile
from pathlib import Path


TIMEOUT_SECONDS = 60


def is_valid_hwpx(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0 and zipfile.is_zipfile(path)


class HancomHwpConverter:
    def __init__(self) -> None:
        import pythoncom
        import win32com.client

        self.pythoncom = pythoncom
        self.pythoncom.CoInitialize()
        self.hwp = win32com.client.gencache.EnsureDispatch("HWPFrame.HwpObject")
        try:
            self.hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModuleExample")
        except Exception:
            pass

    def close(self) -> None:
        try:
            self.hwp.Quit()
        except Exception:
            pass
        try:
            self.pythoncom.CoUninitialize()
        except Exception:
            pass

    def convert(self, source: Path, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        self.hwp.Open(str(source), "HWP", "forceopen:true")
        self.hwp.SaveAs(str(target), "HWPX", "")
        if not is_valid_hwpx(target):
            raise RuntimeError("Hancom COM produced an invalid hwpx")


def convert_one_shot(source: Path, target: Path) -> None:
    converter = HancomHwpConverter()
    try:
        converter.convert(source, target)
    finally:
        converter.close()


def convert_with_timeout(source: Path, target: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "etl.converters.hwp_to_hwpx_hancom",
            str(source),
            str(target),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip()[:500])
    if not is_valid_hwpx(target):
        raise RuntimeError("Hancom COM worker produced an invalid hwpx")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m etl.converters.hwp_to_hwpx_hancom <source.hwp> <target.hwpx>")
    convert_one_shot(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
