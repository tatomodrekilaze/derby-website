"""Pre-render the existing site in all three languages. No runtime server needed."""
from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree as ET
import json
import subprocess
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://derbybilliards.com'
PATHS = {'ka': '/', 'en': '/en/', 'ru': '/ru/'}
LOCALES = {'ka': 'ka_GE', 'en': 'en_GB', 'ru': 'ru_RU'}
VERIFY = 'ZxsdSEFkcuZYoymGaSwtr3kdlsaNDETlDANHIUufQnY'
extra = json.loads((ROOT / 'seo/content.json').read_text(encoding='utf-8'))
js = "const fs=require('node:fs'),vm=require('node:vm');const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('js/i18n.js','utf8'),c,{timeout:1000});process.stdout.write(JSON.stringify(c.window.DERBY_I18N));"
dictionaries = json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT).decode('utf-8'))
for locale in PATHS:
    dictionaries[locale].update(extra[locale])

guide = (ROOT / 'src/visitor-guide.html').read_text(encoding='utf-8')
template = (ROOT / 'src/home.html').read_text(encoding='utf-8')
template = template.replace('    <section class="visit section"', guide + '\n    <section class="visit section"', 1)

def structured_data(locale, page):
    offers = []
    for name, price in [('Pool, 12:00-18:00', 10), ('Pool, from 18:00 until closing', 15), ('Snooker', 20), ('Russian billiards', 18)]:
        offers.append({'@type': 'Offer', 'name': name, 'price': str(price), 'priceCurrency': 'GEL',
                       'priceSpecification': {'@type': 'UnitPriceSpecification', 'price': str(price), 'priceCurrency': 'GEL',
                                              'referenceQuantity': {'@type': 'QuantitativeValue', 'value': 1, 'unitCode': 'HUR'}},
                       'itemOffered': {'@type': 'Service', 'name': name + ' table hire'}})
    return {'@context': 'https://schema.org', '@graph': [
        {'@type': 'WebSite', '@id': ORIGIN + '/#website', 'url': ORIGIN + '/', 'name': 'Derby Billiards Club', 'inLanguage': ['ka', 'en', 'ru']},
        {'@type': 'WebPage', '@id': page + '#webpage', 'url': page, 'name': dictionaries[locale]['meta.title'],
         'inLanguage': locale, 'isPartOf': {'@id': ORIGIN + '/#website'}, 'about': {'@id': ORIGIN + '/#club'}},
        {'@type': 'SportsActivityLocation', '@id': ORIGIN + '/#club', 'name': 'DERBY Billiards Club',
         'alternateName': 'საბილიარდო კლუბი დერბი', 'url': ORIGIN + '/',
         'image': ORIGIN + '/assets/video/poster.jpg', 'logo': ORIGIN + '/assets/img/favicon.png',
         'telephone': '+995568030505', 'priceRange': '10-20 GEL', 'currenciesAccepted': 'GEL',
         'hasMap': 'https://maps.app.goo.gl/Qpp5x2Lm3EM8fWaK8',
         'address': {'@type': 'PostalAddress', 'streetAddress': '3 Marat Nozadze Street, Gldani', 'addressLocality': 'Tbilisi', 'addressCountry': 'GE'},
         'openingHoursSpecification': [{'@type': 'OpeningHoursSpecification', 'dayOfWeek': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], 'opens': '12:00', 'closes': '03:00'}],
         'hasOfferCatalog': {'@type': 'OfferCatalog', 'name': 'Table hire per hour', 'itemListElement': offers},
         'sameAs': ['https://www.instagram.com/derby_billiards/', 'https://www.facebook.com/profile.php?id=61592087275884']}
    ]}

for locale, path in PATHS.items():
    soup = BeautifulSoup(template, 'html.parser')
    words = dictionaries[locale]
    page = ORIGIN + path
    soup.html['lang'] = locale
    soup.title.string = words['meta.title']
    # Absolute local asset paths let each language URL use the exact same design.
    for tag in soup.find_all(True):
        for attr in ['src', 'href', 'poster']:
            value = tag.get(attr, '')
            if value and not value.startswith(('/', '#')) and not urlparse(value).scheme:
                tag[attr] = '/' + value
        key = tag.get('data-i18n')
        if key and isinstance(words.get(key), str):
            tag.string = words[key]
    def meta(key, content, attr='name'):
        tag = soup.find('meta', attrs={attr: key})
        if not tag:
            tag = soup.new_tag('meta', attrs={attr: key})
            soup.head.append(tag)
        tag['content'] = content
    meta('description', words['meta.description'])
    meta('google-site-verification', VERIFY)
    meta('robots', 'index,follow,max-image-preview:large')
    meta('og:title', words['meta.title'], 'property')
    meta('og:description', words['meta.description'], 'property')
    meta('og:url', page, 'property')
    meta('og:locale', LOCALES[locale], 'property')
    meta('og:image:alt', 'Derby Billiards Club in Gldani, Tbilisi', 'property')
    meta('twitter:card', 'summary_large_image')
    meta('twitter:title', words['meta.title'])
    meta('twitter:description', words['meta.description'])
    meta('twitter:image', ORIGIN + '/assets/video/poster.jpg')
    soup.find('link', rel='canonical')['href'] = page
    for code, target in {**PATHS, 'x-default': '/'}.items():
        soup.head.append(soup.new_tag('link', rel='alternate', hreflang=code, href=ORIGIN + target))
    for button in soup.select('.lang [data-lang]'):
        code = button['data-lang']
        link = soup.new_tag('a', href=PATHS[code], attrs={'data-lang': code, 'lang': code,
                             'hreflang': code, 'aria-label': {'ka': 'ქართული', 'en': 'English', 'ru': 'Русский'}[code]})
        link.string = button.get_text()
        if code == locale:
            link['class'] = 'is-on'
            link['aria-current'] = 'page'
        button.replace_with(link)
    for index, img in enumerate(soup.select('.space .shot img'), start=1):
        img['alt'] = words[f'alt.hall{index}']
        img['loading'] = 'lazy'
    for img in soup.select('.spot__img'):
        img['alt'] = words['alt.storefront']
    # Populate hours for crawlers and people browsing without JavaScript.
    hours = soup.select_one('#hoursList')
    if hours:
        hours.clear()
        for day in words['days']:
            li = soup.new_tag('li')
            day_tag = soup.new_tag('span', attrs={'class': 'hours__day'})
            day_tag.string = day
            time_tag = soup.new_tag('span', attrs={'class': 'hours__time'})
            time_tag.string = '12:00-03:00'
            li.extend([day_tag, time_tag])
            hours.append(li)
    for tag in soup.select('[data-status-main]'):
        tag.string = words['hours.title']
    for tag in soup.select('[data-status-sub]'):
        tag.string = '12:00-03:00'
    for tag in soup.find_all('script', type='application/ld+json'):
        tag.decompose()
    data = soup.new_tag('script', type='application/ld+json')
    data.string = json.dumps(structured_data(locale, page), ensure_ascii=False)
    soup.head.append(data)
    content_script = soup.new_tag('script', src='/js/seo-content.js?v=1')
    soup.find('script', src='/js/i18n.js?v=10').insert_after(content_script)
    soup.find('script', src='/js/main.js?v=13')['src'] = '/js/main.js?v=14'
    soup.find('link', rel='stylesheet', href='/css/style.css?v=13')['href'] = '/css/style.css?v=14'
    noscript = soup.new_tag('noscript')
    style = soup.new_tag('style')
    style.string = 'body.is-loading{overflow:auto!important}.intro,.cursor{display:none!important}.hero__content,.hero__hud{visibility:visible!important}.hero__title .line>*{transform:none!important}'
    noscript.append(style)
    soup.head.append(noscript)
    output = ROOT / ('index.html' if locale == 'ka' else f'{locale}/index.html')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(str(soup).rstrip() + '\n', encoding='utf-8')

(ROOT / 'js/seo-content.js').write_text(
    '/* Shared visitor content and SEO titles. Generated by scripts/build-seo.py. */\n' +
    '(function(){const content=' + json.dumps(extra, ensure_ascii=False) +
    ';Object.keys(content).forEach(function(locale){Object.assign(window.DERBY_I18N[locale],content[locale]);});})();\n', encoding='utf-8')

ns = 'http://www.sitemaps.org/schemas/sitemap/0.9'
xhtml = 'http://www.w3.org/1999/xhtml'
ET.register_namespace('', ns)
ET.register_namespace('xhtml', xhtml)
sitemap = ET.Element(f'{{{ns}}}urlset')
for path in PATHS.values():
    url = ET.SubElement(sitemap, f'{{{ns}}}url')
    ET.SubElement(url, f'{{{ns}}}loc').text = ORIGIN + path
    for code, target in {**PATHS, 'x-default': '/'}.items():
        ET.SubElement(url, f'{{{xhtml}}}link', rel='alternate', hreflang=code, href=ORIGIN + target)
ET.indent(sitemap)
ET.ElementTree(sitemap).write(ROOT / 'sitemap.xml', encoding='utf-8', xml_declaration=True)
print('Built Georgian, English and Russian pages, metadata, visitor guides and multilingual sitemap.')
