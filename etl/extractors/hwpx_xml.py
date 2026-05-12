import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from etl.extractors.docx_xml import clean_text


def _xml_text_from_zip(path: Path, prefixes: tuple[str, ...]) -> str:
    parts: list[str] = []
    with zipfile.ZipFile(path) as zf:
        names = sorted(
            name
            for name in zf.namelist()
            if name.endswith(".xml") and any(name.startswith(prefix) for prefix in prefixes)
        )
        for name in names:
            try:
                root = ET.fromstring(zf.read(name))
            except ET.ParseError:
                continue
            tokens = [token.strip() for token in root.itertext() if token and token.strip()]
            if tokens:
                parts.append("\n".join(tokens))
    return clean_text("\n\n".join(parts))


def extract_text(path: Path) -> str:
    text = _xml_text_from_zip(path, ("Contents/section", "Contents/header.xml"))
    if text:
        return text
    with zipfile.ZipFile(path) as zf:
        try:
            return clean_text(zf.read("Preview/PrvText.txt").decode("utf-8", errors="replace"))
        except KeyError:
            return ""
