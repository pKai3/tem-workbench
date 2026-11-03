#!/usr/bin/env python3
"""Render the maintained manuscript and its editable workflow figure (ReportLab)."""
import argparse
import re
from html import escape
from pathlib import Path
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from reportlab.graphics import renderSVG

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/paper'


def figure():
    d = Drawing(490, 285)
    ink = colors.HexColor('#15334a')
    blue = colors.HexColor('#edf4f8')
    def box(x,y,w,h,lines):
        d.add(Rect(x,y,w,h,rx=5,ry=5,fillColor=blue,strokeColor=ink,strokeWidth=.7))
        for i,line in enumerate(lines):
            d.add(String(x+w/2,y+h/2+(len(lines)-1)*6-i*12,line,fontName='Paper',fontSize=9,textAnchor='middle',fillColor=ink))
    def arrow(x,y,xx,yy):
        d.add(Line(x,y,xx,yy,strokeColor=ink,strokeWidth=1))
        if yy<y: points=[xx,yy,xx-3,yy+6,xx+3,yy+6]
        elif xx>x: points=[xx,yy,xx-6,yy-3,xx-6,yy+3]
        else: points=[xx,yy,xx+6,yy-3,xx+6,yy+3]
        d.add(Polygon(points,fillColor=ink,strokeColor=None))
    box(0,239,235,42,['Real-space image crops','Mean / Hann → FFT → peak detection'])
    box(255,239,235,42,['Direct diffraction image','Centre / calibration → spot detection'])
    arrow(117,239,117,224); arrow(372,239,372,224)
    box(0,187,490,37,['Observed reciprocal profiles','Opposite grouping · weights · measurement descriptors'])
    arrow(117,187,117,170); arrow(372,187,372,170)
    box(0,116,235,54,['Crystal-template search','Rotate / scale → one-to-one assignment','Position + scale + peak-evidence rank'])
    box(255,116,235,54,['Geometry-only check','Freely fitted reciprocal grids','Primary / residual-pattern evidence'])
    arrow(117,116,117,99); arrow(372,116,372,99)
    box(0,62,490,37,['Acceptance and competing explanations','Compatible · ambiguous · separate patterns · unresolved'])
    arrow(245,62,245,46)
    box(0,0,490,46,['Independent windows → spatial summaries','Uniform / adaptive grids · overlapping placement passes','Inspectable results, settings and exports'])
    return d


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--font',required=True,help='Unicode TrueType font, e.g. DejaVuSans.ttf')
    args=p.parse_args()
    fp=Path(args.font)
    pdfmetrics.registerFont(TTFont('Paper',str(fp)))
    bold=fp.with_name(fp.stem+'-Bold'+fp.suffix)
    pdfmetrics.registerFont(TTFont('PaperBold',str(bold if bold.exists() else fp)))
    pdfmetrics.registerFontFamily('Paper',normal='Paper',bold='PaperBold',italic='Paper',boldItalic='PaperBold')
    base=dict(fontName='Paper',fontSize=9.6,leading=13.8,textColor=colors.HexColor('#20313e'),spaceAfter=8)
    styles={'body':ParagraphStyle('body',**base)}
    def style(name,**kw):
        styles[name]=ParagraphStyle(name,parent=styles['body'],**kw)
    style('title',fontName='PaperBold',fontSize=24,leading=28,spaceAfter=12)
    style('subtitle',fontSize=15,leading=20,spaceAfter=15)
    style('section',fontName='PaperBold',fontSize=13,leading=17,spaceBefore=6,spaceAfter=10,keepWithNext=True)
    style('subsection',fontName='PaperBold',fontSize=10.4,leading=14,spaceBefore=5,keepWithNext=True)
    style('eq',fontSize=9,leading=13,backColor=colors.HexColor('#edf4f8'),borderPadding=7,spaceBefore=4,spaceAfter=12)
    style('caption',fontSize=8.4,leading=11.5)
    style('reference',fontSize=8,leading=10.5,spaceAfter=6)
    style('table',fontSize=8,leading=11,spaceAfter=0)
    style('tablehead',fontName='PaperBold',fontSize=8,leading=11,spaceAfter=0)
    def para(s,kind='body'):
        s=escape(s)
        s=re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',s)
        s=re.sub(r'(https?://[^\s]+)',lambda m:'<link href="'+m[1]+'" color="#245d83">'+m[1]+'</link>',s)
        return Paragraph(s,styles[kind])
    drawing=figure()
    renderSVG.drawToFile(drawing,str(OUT/'workflow.svg'))
    story=[]
    lines=(OUT/'tem-workbench-manuscript.md').read_text().splitlines()
    buf=[]
    def flush():
        if not buf:return
        text=' '.join(buf);buf.clear()
        kind='reference' if re.match(r'^\[\d+\]',text) else ('caption' if re.match(r'^(Figure|Table) \d+\.',text) else 'body')
        story.append(para(text,kind))
    i=0
    while i<len(lines):
        line=lines[i].strip();i+=1
        if not line:flush();continue
        if line=='<!-- pagebreak -->':flush();story.append(PageBreak());continue
        if line=='<!-- workflow-figure -->':flush();story.extend([drawing,Spacer(1,10)]);continue
        if line.startswith('#'):
            flush();n=len(line)-len(line.lstrip('#'));story.append(para(line[n:].strip(),{1:'title',2:'subtitle',3:'section',4:'subsection'}[n]));continue
        if line.startswith('> '):flush();story.append(para(line[2:],'eq'));continue
        if line.startswith('|'):
            flush(); rows=[line]
            while i<len(lines) and lines[i].strip().startswith('|'):
                rows.append(lines[i].strip());i+=1
            rows=[r for r in rows if not re.match(r'^\|[\s:|\-]+$',r)]
            data=[[para(c.strip(),'tablehead' if j==0 else 'table') for c in r.strip('|').split('|')] for j,r in enumerate(rows)]
            widths=[490/len(data[0])]*len(data[0])
            table=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
            table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e6eff5')),('LINEBELOW',(0,0),(-1,0),.7,colors.HexColor('#617e90')),('LINEBELOW',(0,1),(-1,-1),.3,colors.HexColor('#c5d1da')),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
            story.extend([table,Spacer(1,9)]);continue
        buf.append(line)
    flush()
    def furniture(c,doc):
        c.saveState();c.setFont('Paper',8);c.setFillColor(colors.HexColor('#627788'))
        c.drawString(49,A4[1]-29,'TEM WORKBENCH  /  METHODS DRAFT')
        c.drawRightString(A4[0]-49,A4[1]-29,'4 November 2026')
        c.setStrokeColor(colors.HexColor('#c5d1da'));c.line(49,40,A4[0]-49,40)
        c.drawString(49,26,'Implementation snapshot 64118d8 · validation pending')
        c.drawRightString(A4[0]-49,26,str(doc.page));c.restoreState()
    doc=SimpleDocTemplate(str(OUT/'tem-workbench-manuscript.pdf'),pagesize=A4,invariant=1,rightMargin=49,leftMargin=49,topMargin=48,bottomMargin=53,title='TEM Workbench: interpretable crystallographic candidate mapping',author='TEM Workbench contributors')
    doc.build(story,onFirstPage=furniture,onLaterPages=furniture)
    print(OUT/'tem-workbench-manuscript.pdf')

if __name__=='__main__':main()
