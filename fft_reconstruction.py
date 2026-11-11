"""Phase-preserving reciprocal masks. Independent of detection and crystal fitting."""
import numpy as np
from scipy.fft import fft2, ifft2, fftshift, ifftshift, fftfreq
from analysis_core import prepare_fft_input, processed_fft_signal
import region_masks

VERSION = 1


def validate_masks(settings):
    if not isinstance(settings, dict):
        raise ValueError('Mask settings must be an object.')
    mode = settings.get('mode', 'keep')
    if mode not in ('keep', 'reject'):
        raise ValueError('Choose Keep spots or Reject spots.')
    dc = settings.get('keep_dc', False)
    if not isinstance(dc, bool):
        raise ValueError('Keep DC must be enabled or disabled.')
    spots = settings.get('spots', [])
    if not isinstance(spots, list) or len(spots) > 128:
        raise ValueError('Use at most 128 paired masks.')
    clean = []
    for spot in spots:
        try:
            values = {k: float(spot[k]) for k in ('qx', 'qy', 'radius', 'feather')}
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError('Each mask needs numeric coordinates, radius and edge fade.') from error
        if not all(np.isfinite(v) for v in values.values()):
            raise ValueError('Mask coordinates must be finite.')
        if not (0 < values['radius'] <= 100 and 0 <= values['feather'] <= values['radius']):
            raise ValueError('Mask radius must be positive and edge fade between zero and the radius.')
        clean.append(values)
    return dict(mode=mode, keep_dc=dc, spots=clean, conjugate_pairs=True)


def prepare(array, roi, info, processing):
    if info.get('image_kind') == 'diffraction':
        raise ValueError('Inverse FFT needs a real-space image, not recorded diffraction intensity.')
    x,y,w,h = (roi[k] for k in ('x','y','w','h'))
    sx,sy = info['pixel_x_nm'],info['pixel_y_nm']
    z = prepare_fft_input(array[y:y+h,x:x+w], processing['fft_window'], processing['remove_mean'], region_masks.mask(roi,sx,sy))
    return z, fft2(z, workers=2)


def transfer_mask(shape, sx, sy, settings):
    """Unshifted real even transfer function, including Nyquist self-pairs."""
    h,w=shape
    x=fftshift(fftfreq(w,sx)).astype('float32')[None,:]
    y=-fftshift(fftfreq(h,sy)).astype('float32')[:,None]
    union=np.zeros(shape,dtype='float32')
    for spot in settings['spots']:
        if abs(spot['qx']) > .5/sx or abs(spot['qy']) > .5/sy:
            raise ValueError('A mask centre lies outside the sampled FFT.')
        for sign in (1,-1):
            distance=np.hypot(x-sign*spot['qx'],y-sign*spot['qy'])
            r,f=spot['radius'],spot['feather']
            weight=(distance<=r).astype('float32') if f==0 else .5-.5*np.cos(np.pi*np.clip((r-distance)/f,0,1))
            np.maximum(union,weight,out=union)
    union=ifftshift(union)
    opposite=union[np.ix_((-np.arange(h))%h,(-np.arange(w))%w)]
    np.maximum(union,opposite,out=union)
    mask=union if settings['mode']=='keep' else 1-union
    mask[0,0]=float(settings['keep_dc'])
    return mask


def reconstruct(coefficients, sx, sy, settings):
    settings=validate_masks(settings)
    mask=transfer_mask(coefficients.shape,sx,sy,settings)
    filtered=ifft2(coefficients*mask,workers=2)
    return filtered.real.copy(), mask, float(np.max(np.abs(filtered.imag)))


def spectrum_view(coefficients, sx, sy, limit, smoothing_sigma=None):
    h,w=coefficients.shape
    fx=fftshift(fftfreq(w,sx));fy=-fftshift(fftfreq(h,sy))
    # Match the detector's padded field before trimming both display planes together.
    field_limit=limit if smoothing_sigma is None else limit*1.05
    ix=np.flatnonzero(abs(fx)<=field_limit);iy=np.flatnonzero(abs(fy)<=field_limit)
    power=np.log1p(abs(fftshift(coefficients)[np.ix_(iy,ix)])**2)
    dx,dy=1/(w*sx),1/(h*sy)
    if smoothing_sigma is not None:
        xx,yy=np.meshgrid(fx[ix],fy[iy])
        signal=processed_fft_signal(power,np.hypot(xx,yy),max(dx,dy),smoothing_sigma)
        cx=np.flatnonzero(abs(fx[ix])<=limit);cy=np.flatnonzero(abs(fy[iy])<=limit)
        power=power[np.ix_(cy,cx)];signal=signal[np.ix_(cy,cx)]
        ix=ix[cx];iy=iy[cy]
    # Pixel-edge extent aligns the display with actual frequency-bin centres.
    extent=[float(fx[ix[0]]-dx/2),float(fx[ix[-1]]+dx/2),float(fy[iy[-1]]-dy/2),float(fy[iy[0]]+dy/2)]
    return (power,extent) if smoothing_sigma is None else (power,signal,extent)
