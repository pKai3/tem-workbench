#!/usr/bin/env python3
"""Regenerate the editable architecture atlas. Requires ReportLab and a Unicode font."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/architecture/architecture.json'
OUT = SOURCE.parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_review(document):
    changed = [name for name, expected in document['reviewed_sources'].items()
               if not (ROOT / name).is_file() or digest(ROOT / name) != expected]
    if changed:
        raise SystemExit('Diagram review required for changed sources: ' + ', '.join(changed) +
                         '\nReview/update architecture.json, then use --record-review.')


def unicode_font(explicit):
    candidates = [Path(explicit)] if explicit else []
    candidates += [Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
                   Path('/System/Library/Fonts/Supplemental/Arial.ttf'),
                   Path('C:/Windows/Fonts/arial.ttf')]
    try:
        import matplotlib
        candidates.insert(0 if not explicit else 1, Path(matplotlib.get_data_path()) / 'fonts/ttf/DejaVuSans.ttf')
    except ImportError:
        pass
    for path in candidates:
        if path.is_file():
            return path
    raise SystemExit('Pass --font /path/to/DejaVuSans.ttf (or another Unicode TTF font).')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font', help='Unicode TrueType font; embedded in the PDF')
    parser.add_argument('--record-review', action='store_true', help='Record source hashes AFTER reviewing diagram accuracy')
    parser.add_argument('--check', action='store_true', help='Check code review and generated-artifact freshness without rendering')
    args = parser.parse_args()
    document = json.loads(SOURCE.read_text())
    if args.record_review:
        document['reviewed_sources'] = {name: digest(ROOT / name) for name in document['reviewed_sources']}
        SOURCE.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n')
    check_review(document)
    inputs = {'diagram_sha256': digest(SOURCE), 'renderer_sha256': digest(Path(__file__))}
    manifest = OUT / 'build.json'
    if args.check:
        recorded = json.loads(manifest.read_text())
        if any(recorded.get(k) != v for k, v in inputs.items()):
            raise SystemExit('Generated diagrams are stale. Run tools/render_architecture.py.')
        for name, expected in recorded['artifacts'].items():
            if not (OUT / name).is_file() or digest(OUT / name) != expected:
                raise SystemExit('Missing or changed diagram artifact: ' + name)
        print('Architecture source review and generated artifacts are current.')
        return

    from reportlab.graphics.shapes import Drawing, Rect, String, Polygon, PolyLine, Line
    from reportlab.graphics import renderPDF, renderSVG
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import HexColor
    import math

    font_path = unicode_font(args.font)
    pdfmetrics.registerFont(TTFont('Diagram', str(font_path)))
    bold_paths = [font_path.with_name(font_path.stem + '-Bold.ttf'),
                  font_path.with_name('DejaVuSans-Bold.ttf'), font_path.with_name('Arial Bold.ttf'),
                  font_path.with_name('arialbd.ttf')]
    bold = next((p for p in bold_paths if p.is_file()), font_path)
    pdfmetrics.registerFont(TTFont('DiagramBold', str(bold)))
    W, H = document['size']
    ink, muted, blue = '#172a3a', '#516473', '#165b82'
    fills = {'process':'#ffffff', 'note':'#f2f5f7', 'result':'#eaf4f4', 'decision':'#edf3f8'}

    def wrapped(text, width, size, font='Diagram'):
        result = []
        for paragraph in text.split('\n'):
            line = ''
            for word in paragraph.split(' '):
                proposed = (line + ' ' + word).strip()
                if pdfmetrics.stringWidth(proposed, font, size) <= width:
                    line = proposed
                elif line:
                    result.append(line); line = word
                else:
                    raise ValueError('Text too wide: ' + word)
            result.append(line)
        return result

    artifacts = []
    pdf_path = OUT / 'tem-workbench-architecture.pdf'
    pdf = canvas.Canvas(str(pdf_path), pagesize=(W,H), pageCompression=1, invariant=1)
    pdf.setTitle('TEM Workbench - architecture and numerical workflow')
    pdf.setAuthor('TEM Workbench contributors')
    pdf.setSubject('Editable implementation diagrams; heuristic candidate matching, not phase validation')
    for page_number, page in enumerate(document['pages'], 1):
        drawing = Drawing(W,H)
        def string(x, y, content, size=12, color=ink, bold=False, anchor='start'):
            drawing.add(String(x,H-y,content,fontName='DiagramBold' if bold else 'Diagram',fontSize=size,
                               fillColor=HexColor(color),textAnchor=anchor))
        def box(x,y,w,h,fill='#ffffff',stroke='#a4b3bd',radius=5):
            drawing.add(Rect(x,H-y-h,w,h,rx=radius,ry=radius,fillColor=HexColor(fill),
                             strokeColor=HexColor(stroke),strokeWidth=.9))
        def paragraph(x,y,text,width,size=12,color=ink,bold=False,leading=None):
            lines=wrapped(text,width,size,'DiagramBold' if bold else 'Diagram')
            for line in lines:
                string(x,y,line,size,color,bold)
                y += leading or size*1.30
            return y
        box(0,0,W,H,fill='#ffffff',stroke='#ffffff',radius=0)
        string(34,30,'TEM WORKBENCH / METHODS ATLAS',10,blue,True)
        string(W-34,30,f'{page_number:02d} / {len(document["pages"]):02d}',10,muted,anchor='end')
        string(34,68,page['title'],26,ink,True)
        paragraph(34,93,page['subtitle'],W-68,11.8,muted)
        for group in page.get('groups',[]):
            box(group['x'],group['y'],group['w'],group['h'],fill='#f8fafb',stroke='#d8e1e7')
            string(group['x']+14,group['y']+22,group['title'],11,blue,True)
        for edge in page.get('edges',[]):
            pts=edge['points'];flat=[v for x,y in pts for v in (x,H-y)]
            drawing.add(PolyLine(flat,strokeColor=HexColor(edge.get('color','#637683')),strokeWidth=1.15,
                                 strokeDashArray=[4,3] if edge.get('dashed') else None))
            x,y=pts[-1];ax,ay=pts[-2];theta=math.atan2(y-ay,x-ax);length=6.5
            polygon=[x,H-y]
            for a in (theta+2.65,theta-2.65):
                polygon += [x+length*math.cos(a),H-(y+length*math.sin(a))]
            drawing.add(Polygon(polygon,fillColor=HexColor('#637683'),strokeColor=None))
        for node in page['nodes']:
            x,y,w,h=[node[k] for k in ('x','y','w','h')]
            if x<20 or y<110 or x+w>W-20 or y+h>H-38:
                raise ValueError(f"Page {page_number}: out-of-bounds node {node['id']}")
            kind=node.get('kind','process')
            if kind=='decision':
                drawing.add(Polygon([x+w/2,H-y,x+w,H-y-h/2,x+w/2,H-y-h,x,H-y-h/2],
                                    fillColor=HexColor(fills[kind]),strokeColor=HexColor('#7e99aa'),strokeWidth=1))
                lines=wrapped(node['title'],w*.60,12.4,'DiagramBold')
                for i,line in enumerate(lines):
                    string(x+w/2,y+h/2-(len(lines)-1)*7.5+i*15+4,line,12.4,ink,True,'middle')
                continue
            box(x,y,w,h,fill=fills[kind],stroke='#a4b3bd')
            yy=paragraph(x+14,y+21,node['title'],w-28,node.get('title_size',13),blue,True)
            if node.get('body'):
                yy+=4
            for part in node.get('body',[]):
                yy=paragraph(x+14,yy,part,w-28,node.get('font_size',11.5),ink)
                yy+=4
            bottom = yy - 4 - node.get('font_size',11.5)*1.05 if node.get('body') else yy - node.get('title_size',13)*1.05
            if bottom > y+h-8:
                raise ValueError(f"Page {page_number}: text overflows {node['id']} by {bottom-(y+h-8):.1f} pt")
        for edge in page.get('edges',[]):
            if edge.get('label'):
                x,y=edge['label_at'];text=edge['label'];width=pdfmetrics.stringWidth(text,'Diagram',10.5)+10
                box(x-width/2,y-12,width,17,fill='#ffffff',stroke='#ffffff',radius=2)
                string(x,y,text,10.5,muted,anchor='middle')
        drawing.add(Line(34,28,W-34,28,strokeColor=HexColor('#d8e1e7'),strokeWidth=.8))
        string(34,H-13,page['sources'],9,muted)
        string(W-34,H-13,'Implementation snapshot · '+document['review_date'],9,muted,anchor='end')
        path=OUT/(page['slug']+'.svg')
        renderSVG.drawToFile(drawing,str(path))
        svg=path.read_text()
        svg=svg.replace('font-family: DiagramBold;', 'font-family: DejaVu Sans, Arial, sans-serif; font-weight: bold;')
        svg=svg.replace('font-family: Diagram;', 'font-family: DejaVu Sans, Arial, sans-serif;')
        # An accessible title, preserved as editable vector text and shapes.
        from xml.sax.saxutils import escape
        at=svg.index('>',svg.index('<svg'))+1
        svg=svg[:at]+'\n<title>'+escape(page['title'])+'</title>\n<desc>'+escape(page['subtitle'])+'</desc>'+svg[at:]
        path.write_text(svg);artifacts.append(path.name)
        pdf.bookmarkPage(page['slug']);pdf.addOutlineEntry(page['title'],page['slug'])
        renderPDF.draw(drawing,pdf,0,0);pdf.showPage()
    pdf.save();artifacts.append(pdf_path.name)
    manifest.write_text(json.dumps({**inputs,'font':font_path.name,'artifacts':{name:digest(OUT/name) for name in artifacts}},indent=2)+'\n')
    print(f'Rendered {len(document["pages"])} SVG panels and {pdf_path.name}.')


if __name__=='__main__':
    main()
