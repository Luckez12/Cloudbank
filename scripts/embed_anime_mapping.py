"""Embed the mapping adapter outside original upstream source boundaries."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
IDS = ('hianime', 'hianime-v2', 'animepahe', 'animepahe-v2', 'anizone-v2', 'anikototv')
START = '/* CLOUDBANK_ANIME_MAPPING_START */'
END = '/* CLOUDBANK_ANIME_MAPPING_END */'
def main():
    helper = (ROOT / 'scripts/anime-mapping.js').read_text().rstrip()
    for provider_id in IDS:
        path = ROOT / 'providers' / (provider_id + '.js')
        source = path.read_text()
        if START in source:
            start, end = source.index(START), source.index(END) + len(END) + 1
            source = source[:start] + source[end:]
        point = source.index('(function() {\n  var originalModule')
        source = source[:point] + START + '\n' + helper + '\n' + END + '\n' + source[point:]
        old = 'portableRequire, cloudbankMetadataFetch(fetch),'
        new = 'portableRequire, cloudbankAnimeMappingFetch(cloudbankMetadataFetch(fetch)),'
        if old not in source and new not in source:
            raise ValueError('Provider adapter not found: ' + provider_id)
        path.write_text(source.replace(old, new).replace("}, 19000);", "}, 45000);"))
if __name__ == '__main__':
    main()
