import base64,re,pathlib
K=pathlib.Path('/workspace/definite-integral/vendor/katex')
css=(K/'katex.min.css').read_text()
def rep(m):
    f=m.group(1)
    b=base64.b64encode((K/'fonts'/f).read_bytes()).decode()
    return f'src:url(data:font/woff2;base64,{b}) format("woff2")'
css=re.sub(r'src:url\(fonts/([\w-]+\.woff2)\) format\("woff2"\)(,url\([^)]*\) format\("[^"]*"\))*',rep,css)
assert 'fonts/' not in css, 'font refs left'
js=(K/'katex.min.js').read_text()
t=pathlib.Path(__file__).with_name('app.html').read_text()
t=t.replace('/*KATEX_CSS*/',css).replace('/*KATEX_JS*/',js.replace('</script','<\\/script'))
pathlib.Path(__file__).parent.parent.joinpath('index.html').write_text(t)
print(len(t))
