// Generates test fixtures: a small EPUB, a text PDF with headers/footers/page numbers/citations,
// and an image-only ("scanned") PDF. Run: npm run fixtures
import { chromium } from 'playwright'
import JSZip from 'jszip'
import { writeFile, mkdir } from 'node:fs/promises'

const OUT = new URL('../tests/fixtures/', import.meta.url)
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()

// ---------- cover image ----------
await page.setViewportSize({ width: 400, height: 600 })
await page.setContent(`<body style="margin:0;width:400px;height:600px;background:linear-gradient(160deg,#2F54EB,#0b1a5c);color:white;font-family:Georgia;display:flex;flex-direction:column;justify-content:center;align-items:center"><div style="font-size:46px;text-align:center;padding:20px">Alice’s Adventures in Wonderland</div><div style="font-size:22px;margin-top:20px">Lewis Carroll</div></body>`)
const cover = await page.screenshot({ type: 'png' })

// ---------- EPUB ----------
const chapters = [
  {
    title: 'Down the Rabbit-Hole',
    paras: [
      'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice, “without pictures or conversations?”',
      'So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.',
      'There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, “Oh dear! Oh dear! I shall be late!”<sup><a epub:type="noteref" href="#n1">1</a></sup> But when the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet.',
      'In another moment down went Alice after it, never once considering how in the world she was to get out again. The rabbit-hole went straight on like a tunnel for some way, and then dipped suddenly down, so suddenly that Alice had not a moment to think about stopping herself before she found herself falling down a very deep well.',
      'Either the well was very deep, or she fell very slowly, for she had plenty of time as she went down to look about her and to wonder what was going to happen next. First, she tried to look down and make out what she was coming to, but it was too dark to see anything.',
      'Then she looked at the sides of the well, and noticed that they were filled with cupboards and book-shelves; here and there she saw maps and pictures hung upon pegs. She took down a jar from one of the shelves as she passed; it was labelled “ORANGE MARMALADE”, but to her great disappointment it was empty.',
    ],
  },
  {
    title: 'The Pool of Tears',
    paras: [
      '“Curiouser and curiouser!” cried Alice (she was so much surprised, that for the moment she quite forgot how to speak good English); “now I’m opening out like the largest telescope that ever was! Good-bye, feet!”',
      'For when she looked down at her feet, they seemed to be almost out of sight, they were getting so far off. “Oh, my poor little feet, I wonder who will put on your shoes and stockings for you now, dears? I’m sure I shan’t be able!”',
      'Just then her head struck against the roof of the hall: in fact she was now more than nine feet high, and she at once took up the little golden key and hurried off to the garden door.',
      'Poor Alice! It was as much as she could do, lying down on one side, to look through into the garden with one eye; but to get through was more hopeless than ever: she sat down and began to cry again.',
    ],
  },
  {
    title: 'A Caucus-Race and a Long Tale',
    paras: [
      'They were indeed a queer-looking party that assembled on the bank, the birds with draggled feathers, the animals with their fur clinging close to them, and all dripping wet, cross, and uncomfortable.',
      'The first question of course was, how to get dry again: they had a consultation about this, and after a few minutes it seemed quite natural to Alice to find herself talking familiarly with them, as if she had known them all her life.',
      'At last the Mouse, who seemed to be a person of authority among them, called out, “Sit down, all of you, and listen to me! I’ll soon make you dry enough!” They all sat down at once, in a large ring, with the Mouse in the middle.',
    ],
  },
]
const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body>${body}</body></html>`
const zip = new JSZip()
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`)
chapters.forEach((c, i) => {
  const notes = i === 0 ? '<aside epub:type="footnote" id="n1"><p>The Rabbit is always late.</p></aside>' : ''
  zip.file(`OEBPS/ch${i + 1}.xhtml`, xhtml(c.title, `<section id="c${i + 1}"><h1>Chapter ${['I', 'II', 'III'][i]}. ${c.title}</h1>${c.paras.map((p) => `<p>${p}</p>`).join('\n')}${notes}</section>`))
})
zip.file('OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml#c${i + 1}">Chapter ${['I', 'II', 'III'][i]}. ${c.title}</a></li>`).join('')}</ol></nav>`))
zip.file('OEBPS/cover.png', cover)
zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">lumen-fixture-alice</dc:identifier><dc:title>Alice’s Adventures in Wonderland</dc:title><dc:creator>Lewis Carroll</dc:creator><dc:language>en</dc:language><meta name="cover" content="cover"/></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>${chapters.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join('')}</spine></package>`)
await writeFile(new URL('alice.epub', OUT), await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' }))

// ---------- text PDF with running header/footer, page numbers, citations ----------
const para = (n) =>
  [
    `Sound travels as a pressure wave through air at roughly 343 metres per second [${n}]. Early experiments measured this speed with cannons and stopwatches (Smith, 2020), and later work refined the figure with electronic timing.`,
    `Researchers found that temperature changes the result noticeably.${n} Warmer air carries sound faster, a point discussed at length elsewhere (Lee & Park, 2019; Ode et al., 2021).`,
    `A full data set is available at https://example.org/sound-data for anyone who wants to check the numbers. The figures are summarised in the appendix [${n + 1}-${n + 3}].`,
    `Humidity has a smaller effect than temperature, but it is still measurable with careful instruments. Engineers designing concert halls take all of these factors into account when they plan the shape of a room.`,
  ].join(' ')
const sectionsHtml = [1, 2, 3, 4].map((s) => `<h1>Section ${s}: ${['How sound moves', 'Temperature', 'Humidity', 'Rooms and echoes'][s - 1]}</h1>` + [1, 2, 3].map((k) => `<p>${para(s * 10 + k)}</p>`).join('')).join('')
await page.setContent(`<html><head><style>body{font-family:Georgia,serif;font-size:13pt;line-height:1.5;margin:0} h1{font-size:20pt;margin:0.8em 0 0.4em} p{margin:0 0 0.8em;text-align:left}</style></head><body>${sectionsHtml}</body></html>`)
await page.pdf({
  path: new URL('sound.pdf', OUT).pathname,
  format: 'A5',
  margin: { top: '60px', bottom: '60px', left: '50px', right: '50px' },
  displayHeaderFooter: true,
  headerTemplate: '<div style="font-size:9px;width:100%;text-align:center;color:#555;font-family:Georgia">Journal of Everyday Acoustics · Volume 3</div>',
  footerTemplate: '<div style="font-size:10px;width:100%;text-align:center;font-family:Georgia"><span class="pageNumber"></span></div>',
  outline: true,
  tagged: true,
})

// ---------- scanned (image-only) PDF ----------
await page.setViewportSize({ width: 600, height: 300 })
await page.setContent('<body style="margin:0;font:28px Georgia;padding:30px">This page is only a picture of text.</body>')
const shot = await page.screenshot({ type: 'png' })
await page.setContent(`<body style="margin:0"><img src="data:image/png;base64,${shot.toString('base64')}" style="width:100%"></body>`)
await page.pdf({ path: new URL('scanned.pdf', OUT).pathname, format: 'A5' })

await browser.close()
console.log('fixtures written to tests/fixtures/')
