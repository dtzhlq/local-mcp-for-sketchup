import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const pdf = 'reference/drawings/calgary-new-home-sample-drawings.pdf';
const out = 'output/calgary-line-layer-review/index.html';
mkdirSync(dirname(out), { recursive: true });
mkdirSync('output/calgary-line-layer-review/assets', { recursive: true });

const python = String.raw`
import fitz, json, math, pathlib
pdf='reference/drawings/calgary-new-home-sample-drawings.pdf'
out=pathlib.Path('output/calgary-line-layer-review/assets')
out.mkdir(parents=True, exist_ok=True)
doc=fitz.open(pdf)
result={}
for page_no,name in [(10,'main-floor'),(11,'upper-floor'),(5,'east-front'),(17,'section-aa')]:
    page=doc[page_no-1]
    pix=page.get_pixmap(matrix=fitz.Matrix(1.8,1.8), alpha=False)
    pix.save(str(out/f'{name}.png'))
    lines=[]
    for d in page.get_drawings():
        width=float(d.get('width') or 0)
        for item in d.get('items',[]):
            if item[0]!='l':
                continue
            p1,p2=item[1],item[2]
            length=math.dist((p1.x,p1.y),(p2.x,p2.y))
            if length < 1.5:
                continue
            horizontal=abs(p1.y-p2.y)<0.4
            vertical=abs(p1.x-p2.x)<0.4
            orth=horizontal or vertical
            if width>=1.2 and length>=20 and orth:
                layer='wall_or_cut_line'
            elif width>=0.9 and length>=16 and orth:
                layer='visible_object_line'
            elif width<=0.3:
                layer='hatch_or_fill'
            elif width<=0.75 and length>=25:
                layer='dimension_or_annotation'
            else:
                layer='minor_detail'
            lines.append({'x1':p1.x,'y1':p1.y,'x2':p2.x,'y2':p2.y,'width':width,'length':length,'layer':layer})
    result[name]={'page':page_no,'rect':[page.rect.x0,page.rect.y0,page.rect.x1,page.rect.y1],'lines':lines}
print(json.dumps(result))
`;
const res = spawnSync('/Library/Frameworks/Python.framework/Versions/3.10/bin/python3', ['-c', python], { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
if (res.status !== 0) {
  process.stderr.write(res.stderr);
  process.exit(res.status || 1);
}
const data = JSON.parse(res.stdout);

function svgFor(name, title) {
  const page = data[name];
  const [x0,y0,x1,y1] = page.rect;
  const image = `assets/${name}.png`;
  const colors = {
    wall_or_cut_line: '#dc2626',
    visible_object_line: '#2563eb',
    dimension_or_annotation: '#f59e0b',
    hatch_or_fill: '#9ca3af',
    minor_detail: '#10b981'
  };
  const widths = {
    wall_or_cut_line: 2.4,
    visible_object_line: 1.7,
    dimension_or_annotation: 1.1,
    hatch_or_fill: 0.7,
    minor_detail: 0.8
  };
  const lines = page.lines.map((l) => `<line class="layer ${l.layer}" x1="${l.x1.toFixed(2)}" y1="${l.y1.toFixed(2)}" x2="${l.x2.toFixed(2)}" y2="${l.y2.toFixed(2)}" stroke="${colors[l.layer]}" stroke-width="${widths[l.layer]}" vector-effect="non-scaling-stroke"/>`).join('\n');
  const counts = page.lines.reduce((acc,l)=>{acc[l.layer]=(acc[l.layer]||0)+1; return acc;}, {});
  return `<section>
<h2>${title}</h2>
<p class="note">红=候选墙/剖切线；蓝=可见物体线；橙=标注/尺寸线；灰=填充线；绿=次要细节。右上角按钮可开关图层。</p>
<div class="counts">${Object.entries(counts).map(([k,v])=>`<span>${k}: ${v}</span>`).join('')}</div>
<div class="canvas-wrap">
<svg viewBox="${x0} ${y0} ${x1-x0} ${y1-y0}">
<image href="${image}" x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}" opacity="0.28"/>
${lines}
</svg>
</div>
</section>`;
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calgary PDF 线型分层审图</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#0f172a}header{background:white;border-bottom:1px solid #cbd5e1;padding:18px 24px;position:sticky;top:0;z-index:2}h1{font-size:20px;margin:0 0 8px}p{margin:4px 0;color:#64748b}main{padding:20px;display:grid;gap:20px}section{background:white;border:1px solid #cbd5e1;padding:16px}h2{font-size:16px;margin:0 0 8px}.note{font-size:13px}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.toolbar label{font:12px ui-monospace,monospace;border:1px solid #cbd5e1;padding:4px 8px;background:#fff}.counts{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px}.counts span{font:11px ui-monospace,monospace;background:#f1f5f9;border:1px solid #cbd5e1;padding:3px 6px}.canvas-wrap{border:1px solid #e5e7eb;overflow:auto;background:white}svg{display:block;width:100%;height:auto;min-width:900px}.hide-wall_or_cut_line .wall_or_cut_line,.hide-visible_object_line .visible_object_line,.hide-dimension_or_annotation .dimension_or_annotation,.hide-hatch_or_fill .hatch_or_fill,.hide-minor_detail .minor_detail{display:none}.legend b{display:inline-block;width:14px;height:8px;margin-right:5px}.red{background:#dc2626}.blue{background:#2563eb}.orange{background:#f59e0b}.gray{background:#9ca3af}.green{background:#10b981}</style>
<script>
function toggleLayer(layer, checked){document.body.classList.toggle('hide-'+layer,!checked)}
</script></head><body>
<header><h1>Calgary PDF 线型分层审图 v0</h1><p>目标不是建模，而是先验证“哪些线能被当作墙/看线，哪些必须过滤成标注/填充”。这一步对了，后面才能直接描图。</p>
<div class="toolbar">
<label><input type="checkbox" checked onchange="toggleLayer('wall_or_cut_line',this.checked)"> 红 墙/剖切候选</label>
<label><input type="checkbox" checked onchange="toggleLayer('visible_object_line',this.checked)"> 蓝 可见物体线</label>
<label><input type="checkbox" checked onchange="toggleLayer('dimension_or_annotation',this.checked)"> 橙 标注尺寸线</label>
<label><input type="checkbox" checked onchange="toggleLayer('hatch_or_fill',this.checked)"> 灰 填充线</label>
<label><input type="checkbox" checked onchange="toggleLayer('minor_detail',this.checked)"> 绿 次要细节</label>
</div></header><main>
<section><h2>读图假设</h2><p class="legend"><b class="red"></b>墙/剖切线通常较粗、正交、连续；<b class="orange"></b>标注线通常细、长、在图框外围；<b class="gray"></b>填充线密集且极细；<b class="blue"></b>门窗、家具、台阶、栏杆等可见线不应直接挤出成墙。</p><p>你可以先只打开红色，看墙体候选是否靠谱；再打开蓝色补门窗/楼梯。这个流程比我之前直接估墙靠谱很多。</p></section>
${svgFor('main-floor','Page 10 主层平面 — 线型分层')}
${svgFor('upper-floor','Page 11 二层平面 — 线型分层')}
${svgFor('east-front','Page 05 东立面 Front — 线型分层')}
${svgFor('section-aa','Page 17 A-A 剖面 — 线型分层')}
</main></body></html>`;
writeFileSync(out, html);
console.log(out);
