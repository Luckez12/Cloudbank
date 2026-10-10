"""Remove the retired display formatter; keep each provider's original output."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
START = "/* CLOUDBANK_STREAM_DISPLAY_START */"
END = "/* CLOUDBANK_STREAM_DISPLAY_END */"
def main():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    for provider in manifest["scrapers"]:
        path = ROOT / provider["filename"]
        source = path.read_text()
        if START not in source:
            continue
        start = source.index(START)
        end = source.index(END, start) + len(END)
        if source[end:].strip():
            raise ValueError("Unexpected code after formatter: " + provider["id"])
        path.write_text(source[:start].removesuffix("\n"))
if __name__ == "__main__":
    main()
