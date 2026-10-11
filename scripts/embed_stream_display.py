"""Embed the standalone presentation formatter in every manifest provider."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = "/* CLOUDBANK_PLAYIMDB_DISPLAY_START */"
END = "/* CLOUDBANK_PLAYIMDB_DISPLAY_END */"


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    formatter = (ROOT / "scripts/stream-display.js").read_text().rstrip()
    for provider in manifest["scrapers"]:
        if provider["id"] == "playimdb":
            continue
        path = ROOT / provider["filename"]
        source = path.read_text()
        if START in source:
            source = source[:source.index(START)]
            if source.endswith("\n"):
                source = source[:-1]
        source += "\n" + START + "\n" + formatter + "\n"
        source += "module.exports = cloudbankDisplayInstall(module.exports, " + json.dumps(provider["name"], ensure_ascii=False) + ", " + json.dumps(provider["id"]) + ");\n"
        source += "if (typeof globalThis !== \"undefined\") globalThis.getStreams = module.exports.getStreams;\n"
        source += 'if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;\n'
        source += 'if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;\n'
        source += END + "\n"
        path.write_text(source)


if __name__ == "__main__":
    main()
