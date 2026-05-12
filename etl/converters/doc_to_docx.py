import zipfile
from pathlib import Path


def is_valid_docx(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0 and zipfile.is_zipfile(path)


class WordDocConverter:
    def __init__(self) -> None:
        import pythoncom
        import win32com.client

        self.pythoncom = pythoncom
        self.pythoncom.CoInitialize()
        self.word = win32com.client.DispatchEx("Word.Application")
        self.word.Visible = False
        self.word.DisplayAlerts = 0

    def close(self) -> None:
        try:
            self.word.Quit()
        except Exception:
            pass
        try:
            self.pythoncom.CoUninitialize()
        except Exception:
            pass

    def convert(self, source: Path, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        doc = None
        try:
            doc = self.word.Documents.Open(
                str(source),
                ConfirmConversions=False,
                ReadOnly=True,
                AddToRecentFiles=False,
                Visible=False,
            )
            doc.SaveAs2(str(target), FileFormat=16)
            doc.Close(False)
            doc = None
        finally:
            if doc is not None:
                try:
                    doc.Close(False)
                except Exception:
                    pass
        if not is_valid_docx(target):
            raise RuntimeError("Word COM produced an invalid docx")
