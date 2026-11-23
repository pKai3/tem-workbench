"""Shared display-only luminance matching for figures and overview images."""
import numpy as np
from PIL import Image


def tone_quantiles(image):
    rgb = np.asarray(image, dtype=np.float32)
    luminance = rgb[..., 0] * .2126 + rgb[..., 1] * .7152 + rgb[..., 2] * .0722
    if rgb.shape[-1] == 4:
        luminance = luminance[rgb[..., 3] > 0]
    return np.percentile(luminance, [5, 95]) if luminance.size else None


def tone_target(ranges):
    ranges = [value for value in ranges if value is not None]
    return tuple(np.median(ranges, axis=0)) if len(ranges) > 1 else None


def match_tone(image, target, source_range=None):
    if target is None:
        return image
    source_range = tone_quantiles(image) if source_range is None else source_range
    if source_range is None:
        return image
    low, high = source_range
    rgb = np.asarray(image, dtype=np.float32)[..., :3].copy()
    if high - low >= 5:
        rgb = (rgb - low) * ((target[1] - target[0]) / (high - low)) + target[0]
    else:
        rgb += (target[0] + target[1]) / 2 - (low + high) / 2
    result = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    if image.mode == 'RGBA':
        result.putalpha(image.getchannel('A'))
    return result
