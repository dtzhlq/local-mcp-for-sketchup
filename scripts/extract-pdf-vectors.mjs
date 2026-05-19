import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [pdfPath = 'reference/drawings/calgary-new-home-sample-drawings.pdf', pageArg = '10', outPath = '/tmp/calgary-vectors/page-10-lines.json'] = process.argv.slice(2);
const page = Number(pageArg);
if (!Number.isInteger(page) || page < 1) throw new Error('page must be a positive integer');

const python = String.raw`
import fitz, json, math, sys
pdf_path, page_arg = sys.argv[1], int(sys.argv[2])
doc = fitz.open(pdf_path)
page = doc[page_arg - 1]
segments = []
curves = []
for drawing in page.get_drawings():
    stroke_width = float(drawing.get('width') or 0)
    color = drawing.get('color')
    for item in drawing.get('items', []):
        kind = item[0]
        if kind == 'l':
            p1, p2 = item[1], item[2]
            length = math.dist((p1.x, p1.y), (p2.x, p2.y))
            segments.append({
                'x1': p1.x, 'y1': p1.y, 'x2': p2.x, 'y2': p2.y,
                'length': length, 'width': stroke_width, 'color': color,
                'horizontal': abs(p1.y - p2.y) < 0.5,
                'vertical': abs(p1.x - p2.x) < 0.5
            })
        elif kind == 'c':
            curves.append({'width': stroke_width})
orthogonal = [s for s in segments if (s['horizontal'] or s['vertical'])]
heavy = [s for s in orthogonal if s['width'] >= 1.0 and s['length'] >= 8]
print(json.dumps({
    'page': page_arg,
    'page_rect': [page.rect.x0, page.rect.y0, page.rect.x1, page.rect.y1],
    'segment_count': len(segments),
    'orthogonal_count': len(orthogonal),
    'heavy_orthogonal_count': len(heavy),
    'segments': segments,
    'heavy_orthogonal': heavy
}, indent=2))
`;

mkdirSync(dirname(outPath), { recursive: true });
const result = spawnSync('python3', ['-c', python, pdfPath, String(page)], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status || 1);
}
writeFileSync(outPath, result.stdout);
console.log(resolve(outPath));
