"""Builds a small Chinese test EPUB: cover, a long chapter, a very short one, and two more long ones."""
import sys, zipfile, random

out = sys.argv[1]
random.seed(7)
PHRASES = ["春风又绿江南岸，", "明月何时照我还。", "他推开窗，看见远处的山在雾里若隐若现；", "“你还记得那年的雪吗？”她问。",
           "时间像一本被风翻动的书，", "每一页都写着不同的名字——", "有人说 Turn 是翻页，也是转身。", "灯下的字安静地排成一行行，",
           "他在 2024 年的冬天第一次读到这本书，", "窗外的雨，一直下到天亮。", "（这是括号里的补充说明。）", "「引号」与《书名号》也要排得好看。"]

def para(n):
    return "".join(random.choice(PHRASES) for _ in range(n)).rstrip("，；——") + "。"

def chapter(title, paras):
    body = "\n".join(f"<p>{para(random.randint(4, 9))}</p>" for _ in range(paras))
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head><title>{title}</title><link rel="stylesheet" href="style.css"/></head>
<body><h2>{title}</h2>
{body}
</body></html>"""

chapters = [("第一章 雾中的山", 40), ("第二章 短章", 2), ("第三章 雪夜", 36), ("第四章 归途", 30)]
cover_svg = """<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
<rect width="600" height="900" fill="#2d4a53"/><rect x="40" y="40" width="520" height="820" fill="none" stroke="#e9dcc0" stroke-width="3"/>
<text x="300" y="400" font-size="88" fill="#e9dcc0" text-anchor="middle" font-family="SimSun">翻篇测试</text>
<text x="300" y="500" font-size="32" fill="#e9dcc0" text-anchor="middle" font-family="SimSun">Turn Test Book</text></svg>"""
cover_xhtml = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>封面</title></head>
<body style="margin:0;text-align:center"><img src="cover.svg" alt="封面" style="height:100%"/></body></html>"""
items = "\n".join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(len(chapters)))
spine = "\n".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:7d1c8f2e-turn-test</dc:identifier><dc:title>翻篇测试</dc:title>
<dc:creator>Turn</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-11-05T00:00:00Z</meta>
<meta name="cover" content="cover-img"/></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="cover-img" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
{items}</manifest>
<spine><itemref idref="cover"/>{spine}</spine></package>"""
nav_items = "\n".join(f'<li><a href="c{i}.xhtml">{t}</a></li>' for i, (t, _) in enumerate(chapters))
nav = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head>
<body><nav epub:type="toc"><ol>{nav_items}</ol></nav>
<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="c0.xhtml">正文</a></li></ol></nav></body></html>"""
container = """<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"""
with zipfile.ZipFile(out, "w") as z:
    z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
    for name, data in [("content.opf", opf), ("nav.xhtml", nav), ("cover.svg", cover_svg), ("cover.xhtml", cover_xhtml),
                       ("style.css", "p { text-indent: 2em; margin: 0; } h2 { text-align: center; margin: 1em 0 1.5em; }")]:
        z.writestr("OEBPS/" + name, data, compress_type=zipfile.ZIP_DEFLATED)
    for i, (t, n) in enumerate(chapters):
        z.writestr(f"OEBPS/c{i}.xhtml", chapter(t, n), compress_type=zipfile.ZIP_DEFLATED)
print("wrote", out)
