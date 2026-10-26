import base64, re, pathlib

root = pathlib.Path(__file__).resolve().parent
repo = root.parent
local_css = root / 'vendor' / 'katex.inline.css'
local_js = root / 'vendor' / 'katex.min.js'
legacy = pathlib.Path('/workspace/definite-integral/vendor/katex')

def from_legacy(K):
    css = (K / 'katex.min.css').read_text()
    def rep(m):
        f = m.group(1)
        b = base64.b64encode((K / 'fonts' / f).read_bytes()).decode()
        return f'src:url(data:font/woff2;base64,{b}) format("woff2")'
    css = re.sub(
        r'src:url\(fonts/([\w-]+\.woff2)\) format\("woff2"\)(,url\([^)]*\) format\("[^"]*"\))*',
        rep,
        css,
    )
    assert 'fonts/' not in css, 'font refs left'
    js = (K / 'katex.min.js').read_text()
    return css, js

if local_css.exists() and local_js.exists():
    css = local_css.read_text()
    js = local_js.read_text()
elif legacy.exists():
    css, js = from_legacy(legacy)
else:
    raise SystemExit('KaTeX vendor missing: src/vendor or definite-integral/vendor/katex')

t = (root / 'app.html').read_text()
if '/*KATEX_CSS*/' not in t or '/*KATEX_JS*/' not in t:
    raise SystemExit('app.html is missing KaTeX placeholders')
t = t.replace('/*KATEX_CSS*/', css).replace('/*KATEX_JS*/', js.replace('</script', '<\\/script'))
(repo / 'index.html').write_text(t)
print(len(t))
