# Turns a single-file Vite build into artifact-ready HTML (no doctype/html/head/body; title first).
import re, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
s = re.sub(r'<!doctype html>\s*', '', s, flags=re.I)
s = re.sub(r'</?html[^>]*>', '', s)
s = re.sub(r'</?head>', '', s)
s = re.sub(r'</?body>', '', s)
s = re.sub(r'<meta charset="UTF-8"\s*/?>', '', s)
s = re.sub(r'<meta name="viewport"[^>]*>', '', s)
m = re.search(r'<title>.*?</title>', s)
if m:
    s = s.replace(m.group(0), '')
s = '<title>SK8.IO</title>\n<style>:root{color-scheme:dark;background:#0d0d0f}</style>\n' + s
open(dst, 'w').write(s)
