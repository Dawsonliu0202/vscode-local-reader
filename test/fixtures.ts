import { zipSync, strToU8 } from 'fflate';
export function epubFixture(version: 2 | 3 = 3, options: { encrypted?: boolean; fixed?: boolean; unsafe?: boolean; entity?: boolean; oversized?: boolean } = {}) {
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': `<?xml version="1.0"?>${options.entity ? '<!DOCTYPE package [<!ENTITY x "bad">]>' : ''}<package version="${version}.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>测试书 &amp; 示例</dc:title><dc:creator>作者甲</dc:creator>${options.fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ''}</metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="z" href="z.xhtml" media-type="application/xhtml+xml"/>${version === 3 ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'}</manifest><spine toc="ncx"><itemref idref="z"/><itemref idref="a"/></spine></package>`,
    'OPS/z.xhtml': '<html><head><script>evil()</script></head><body><h1 id="first">第一章</h1><p>前面 😀 中文。</p><p id="mid">第二段文字</p><script>DO_NOT_RENDER</script></body></html>',
    'OPS/a.xhtml': '<html><body><h1>第二章</h1><p>最后一段。</p></body></html>',
    'OPS/nav.xhtml': '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="z.xhtml#first">开头</a></li><li><a href="z.xhtml#mid">中间</a></li><li><a href="a.xhtml">结束</a></li></ol></nav></body></html>',
    'OPS/toc.ncx': '<?xml version="1.0"?><!DOCTYPE ncx PUBLIC "x" "http://example.invalid/never-fetch.dtd"><ncx><navMap><navPoint><navLabel><text>开头</text></navLabel><content src="z.xhtml#first"/><navPoint><navLabel><text>中间</text></navLabel><content src="z.xhtml#mid"/></navPoint></navPoint><navPoint><navLabel><text>结束</text></navLabel><content src="a.xhtml"/></navPoint></navMap></ncx>'
  };
  if (options.encrypted) files['META-INF/encryption.xml'] = '<encryption><EncryptedData><CipherData><CipherReference URI="OPS/z.xhtml"/></CipherData></EncryptedData></encryption>';
  if (options.unsafe) files['../escape.txt'] = 'unsafe';
  if (options.oversized) files['OPS/z.xhtml'] = 'x'.repeat(20 * 1024 * 1024 + 1);
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strToU8(data)])));
}
