import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


def clean_text(text: str) -> str:
    text = text.replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_text(path: Path) -> str:
    parts: list[str] = []
    prefixes = (
        "word/document.xml",
        "word/header",
        "word/footer",
        "word/footnotes.xml",
        "word/endnotes.xml",
    )
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
