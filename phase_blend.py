"""Display-only passing-support hue blend, mirrored by web/phase-blend.js."""
import colorsys
import math


def blend_support(entries):
    entries = sorted(((color.lower(), float(value)) for color, value in entries if value > 0), key=lambda e: (-e[1], e[0]))
    if not entries:
        return '#596778', 0.
    if len(entries) == 1:
        return entries[0]
    hls = [colorsys.rgb_to_hls(*(int(c[i:i+2], 16)/255 for i in (1,3,5))) for c, _ in entries]
    # Short hue arc around the strongest colour; deterministic at opposite hues.
    anchor = next((h for h, l, s in hls if s > 1e-9), 0.)
    total = sum(v for _, v in entries)
    hue_weight = sum(v*s for (_, v), (_, l, s) in zip(entries, hls))
    hue = (anchor + sum(v*s*((h-anchor+.5) % 1-.5) for (_, v), (h, l, s) in zip(entries, hls))/hue_weight) % 1 if hue_weight else 0.
    light = sum(v*l for (_, v), (_, l, s) in zip(entries, hls))/total
    sat = sum(v*s for (_, v), (_, l, s) in zip(entries, hls))/total
    rgb = colorsys.hls_to_rgb(hue, light, sat)
    return '#' + ''.join(f'{math.floor(c*255+.5):02x}' for c in rgb), entries[0][1]
