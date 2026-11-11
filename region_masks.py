"""Polygon selections in crop-local pixel coordinates; fading in physical nm."""
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt


def validate(roi):
    result = {k: int(roi[k]) for k in ('x', 'y', 'w', 'h')}
    if 'polygon' not in roi:
        return result
    try:
        points = np.asarray(roi['polygon'], dtype=float)
        fade = float(roi.get('edge_fade_nm', 1.))
    except (TypeError, ValueError):
        raise ValueError('Polygon coordinates and edge fading must be numbers.')
    if points.ndim != 2 or points.shape[1] != 2 or not 3 <= len(points) <= 256 or not np.isfinite(points).all():
        raise ValueError('Draw a polygon with 3–256 finite vertices.')
    if not np.isfinite(fade) or not 0 <= fade <= 1000:
        raise ValueError('Edge fading must be between 0 and 1000 nm.')
    if (points < 0).any() or (points[:, 0] > result['w']).any() or (points[:, 1] > result['h']).any():
        raise ValueError('Polygon vertices must lie inside the selected bounds.')
    def cross(a,b,c):
        u,v=b-a,c-a
        return u[0]*v[1]-u[1]*v[0]
    n=len(points)
    for i in range(n):
        a,b=points[i],points[(i+1)%n]
        if np.linalg.norm(b-a) < .01:
            raise ValueError('Polygon vertices must be distinct.')
        for j in range(i+1,n):
            if j == i+1 or (i == 0 and j == n-1): continue
            c,d=points[j],points[(j+1)%n]
            if (max(min(a[0],b[0]),min(c[0],d[0])) <= min(max(a[0],b[0]),max(c[0],d[0])) and
                max(min(a[1],b[1]),min(c[1],d[1])) <= min(max(a[1],b[1]),max(c[1],d[1])) and
                cross(a,b,c)*cross(a,b,d) <= 0 and cross(c,d,a)*cross(c,d,b) <= 0):
                raise ValueError('Polygon edges must not cross or touch each other.')
    area=abs(np.dot(points[:,0],np.roll(points[:,1],1))-np.dot(points[:,1],np.roll(points[:,0],1)))/2
    if area < 32*32:
        raise ValueError('Select a polygon covering at least 1024 pixels.')
    result.update(polygon=points.tolist(),edge_fade_nm=fade)
    return result


def mask(roi, sx, sy):
    if 'polygon' not in roi: return None
    canvas=Image.new('1',(roi['w'],roi['h']))
    ImageDraw.Draw(canvas).polygon([tuple(p) for p in roi['polygon']],fill=1)
    inside=np.asarray(canvas,dtype=bool)
    fade=roi['edge_fade_nm']
    if not fade: return inside.astype('float32')
    # Padding makes image-edge boundaries fade too, including full rectangles.
    distance=distance_transform_edt(np.pad(inside,1),sampling=(sy,sx))[1:-1,1:-1]
    t=np.clip((distance-min(sx,sy)*.5)/fade,0,1)
    return (inside*(.5-.5*np.cos(np.pi*t))).astype('float32')


def response_widths(mask,sx,sy):
    """Axis power-FWHM of the actual mask, with interpolated half-height."""
    widths=[]
    for marginal,spacing in ((mask.sum(axis=0),sx),(mask.sum(axis=1),sy)):
        n=len(marginal)*8
        response=abs(np.fft.rfft(marginal,n=n))**2
        response/=response[0]
        hits=np.flatnonzero(response<=.5)
        if not len(hits): widths.append(1/spacing);continue
        j=int(hits[0]);f=(j-1)+(.5-response[j-1])/(response[j]-response[j-1])
        widths.append(float(2*f/(n*spacing)))
    return widths
