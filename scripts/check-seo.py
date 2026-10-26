from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree as ET
from bs4 import BeautifulSoup
import json
import struct

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://derbybilliards.com'
paths = {'ka': '/', 'en': '/en/', 'ru': '/ru/'}
expected = {**{lang: ORIGIN + path for lang, path in paths.items()}, 'x-default': ORIGIN + '/'}
for filename, expected_size in [('favicon.png', (512, 512)), ('apple-touch-icon.png', (180, 180))]:
    raw = (ROOT / 'assets/img' / filename).read_bytes()
    assert raw[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', raw[16:24]) == expected_size
ico = (ROOT / 'favicon.ico').read_bytes()
assert struct.unpack('<HHH', ico[:6]) == (0, 1, 4)
assert {(ico[6 + i * 16], ico[7 + i * 16]) for i in range(4)} == {(16, 16), (32, 32), (48, 48), (64, 64)}
print('PASS search icons: square PNGs and multiresolution ICO')
for lang, path in paths.items():
    file = ROOT / ('index.html' if lang == 'ka' else f'{lang}/index.html')
    soup = BeautifulSoup(file.read_text(encoding='utf-8'), 'html.parser')
    assert soup.html['lang'] == lang
    assert len(soup.find_all('h1')) == 1
    assert soup.find('link', rel='canonical')['href'] == ORIGIN + path
    assert {tag['hreflang']: tag['href'] for tag in soup.find_all('link', rel='alternate')} == expected
    assert {tag['data-lang']: tag['href'] for tag in soup.select('.lang a')} == paths
    assert soup.select_one('.lang [aria-current="page"]')['data-lang'] == lang
    assert len(soup.select('#hoursList li')) == 7
    assert len(soup.select('.visitor-guide details')) == 4
    assert all(tag.get_text(strip=True) for tag in soup.select('[data-i18n]'))
    assert soup.find('meta', attrs={'name': 'google-site-verification'})['content'] == 'ZxsdSEFkcuZYoymGaSwtr3kdlsaNDETlDANHIUufQnY'
    assert soup.find('meta', attrs={'name': 'description'})['content']
    assert 'noindex' not in soup.find('meta', attrs={'name': 'robots'})['content']
    icons = {tag['href']: tag.get('sizes') for tag in soup.find_all('link', rel='icon')}
    assert icons == {'/favicon.ico': '16x16 32x32 48x48 64x64', '/assets/img/favicon.png': '512x512'}
    assert soup.find('link', rel='apple-touch-icon')['sizes'] == '180x180'
    for tag in soup.find_all(True):
        for attr in ['src', 'href', 'poster']:
            value = tag.get(attr, '')
            if value.startswith('/') and not value.startswith('//'):
                target = ROOT / urlparse(value).path.lstrip('/')
                assert target.exists(), (file, value)
            elif value and not value.startswith('#') and not urlparse(value).scheme:
                raise AssertionError(('relative asset or navigation URL', file, value))
    data = json.loads(soup.find('script', type='application/ld+json').string)
    business = next(item for item in data['@graph'] if item['@type'] == 'SportsActivityLocation')
    assert business['telephone'] == '+995568030505'
    assert business['url'] == ORIGIN + '/'
    assert business['logo'] == {'@type': 'ImageObject', 'url': ORIGIN + '/assets/img/favicon.png', 'width': 512, 'height': 512}
    website = next(item for item in data['@graph'] if item['@type'] == 'WebSite')
    page = next(item for item in data['@graph'] if item['@type'] == 'WebPage')
    assert website['publisher']['@id'] == page['mainEntity']['@id'] == business['@id']
    assert [(o['name'], o['price']) for o in business['hasOfferCatalog']['itemListElement']] == [
        ('Pool, 12:00-18:00', '10'), ('Pool, from 18:00 until closing', '15'), ('Snooker', '20'), ('Russian billiards', '18')]
    assert 'aggregateRating' not in business
    if lang == 'en':
        assert 'Pool' in soup.title.string and 'Tbilisi' in soup.title.string
        assert '10 GEL' in soup.select_one('.visitor-guide').get_text()
        assert '18:00' in soup.select_one('.visitor-guide').get_text()
        assert 'Gldani' in soup.select_one('.visitor-guide').get_text()
    print(f'PASS {path}: rendered content, language links, canonical, metadata, schema, assets, visitor guide')
ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9', 'x': 'http://www.w3.org/1999/xhtml'}
urls = ET.parse(ROOT / 'sitemap.xml').getroot().findall('s:url', ns)
assert {u.find('s:loc', ns).text for u in urls} == set(expected.values())
for url in urls:
    assert {link.get('hreflang'): link.get('href') for link in url.findall('x:link', ns)} == expected
print('PASS sitemap: all three canonical URLs and reciprocal language alternates')
