from pathlib import Path
import re
import zipfile

from etl.extractors.docx_xml import clean_text


def parse_pdf(path: Path) -> tuple[str, str]:
    import pdfplumber

    pages: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if text.strip():
                pages.append(text.strip())
    return "\n\n".join(pages).strip(), "pdfplumber"


def parse_xlsx(path: Path) -> tuple[str, str]:
    import openpyxl

    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    try:
        sheets: list[str] = []
        for ws in wb.worksheets:
            rows: list[str] = []
            for row in ws.iter_rows(values_only=True):
                cells = [str(cell) if cell is not None else "" for cell in row]
                if any(cell.strip() for cell in cells):
                    rows.append("\t".join(cells).rstrip())
            if rows:
                sheets.append("\n".join(rows))
        return "\n\n".join(sheets).strip(), "openpyxl"
    finally:
        wb.close()


def parse_xls(path: Path) -> tuple[str, str]:
    import xlrd

    wb = xlrd.open_workbook(str(path), on_demand=True)
    try:
        sheets: list[str] = []
        for sheet in wb.sheets():
            rows: list[str] = []
            for row_idx in range(sheet.nrows):
                cells = []
                for col_idx in range(sheet.ncols):
                    value = sheet.cell_value(row_idx, col_idx)
                    cells.append(str(value) if value not in (None, "") else "")
                if any(cell.strip() for cell in cells):
                    rows.append("\t".join(cells).rstrip())
            if rows:
                sheets.append(f"[{sheet.name}]\n" + "\n".join(rows))
        return "\n\n".join(sheets).strip(), "xlrd"
    finally:
        wb.release_resources()


def parse_pptx(path: Path) -> tuple[str, str]:
    parts: list[str] = []
    with zipfile.ZipFile(path) as zf:
        names = sorted(
            name
            for name in zf.namelist()
            if (
                name.startswith("ppt/slides/slide")
                or name.startswith("ppt/notesSlides/notesSlide")
                or name.startswith("ppt/comments/comment")
            )
            and name.endswith(".xml")
        )
        for name in names:
            xml = zf.read(name).decode("utf-8", errors="replace")
            tokens = re.findall(r"<a:t[^>]*>(.*?)</a:t>", xml, flags=re.S)
            slide_text = clean_text("\n".join(re.sub(r"<[^>]+>", "", token) for token in tokens))
            if slide_text:
                parts.append(slide_text)
    return "\n\n".join(parts).strip(), "pptx-xml"


def parse_txt(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    for encoding in ("utf-8", "cp949", "euc-kr", "utf-16", "latin-1"):
        try:
            return data.decode(encoding).replace("\x00", "").strip(), f"text-{encoding}"
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace").replace("\x00", "").strip(), "text-replace"


def extract_text(path: Path, extension: str) -> tuple[str, str]:
    ext = extension.lower()
    if ext == ".pdf":
        return parse_pdf(path)
    if ext in {".xlsx", ".xltx"}:
        return parse_xlsx(path)
    if ext == ".xls":
        return parse_xls(path)
    if ext == ".pptx":
        return parse_pptx(path)
    if ext in {".txt", ".csv", ".rtf"}:
        return parse_txt(path)
    raise ValueError(f"no native extractor for {extension}")
