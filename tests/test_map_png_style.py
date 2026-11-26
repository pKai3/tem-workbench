import copy
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

from tem_workbench.mapping.batch_grids import map_png, png_exports
from tem_workbench.mapping.png_style import scale_bar, options, paper_map, overlay_boxes
import test_batch_stability as stability_tests


class MapPngStyleTests(unittest.TestCase):
    def test_legend_alignment_with_and_without_continuous_bar(self):
        image = Image.new('RGB', (1800, 900), 'grey')
        entries = [('α (HCP)', '#ff0000'), ('β (BCC) phase', '#00ff00')]
        original_text, original_polygon = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.polygon
        original_shade, original_rect = ImageDraw.ImageDraw.rounded_rectangle, ImageDraw.ImageDraw.rectangle
        for continuous in (True, False):
            labels, symbols, shades, strips = [], [], [], []
            def text(draw, xy, value, *args, **kwargs):
                labels.append(draw.textbbox(xy, value, font=kwargs['font'], anchor=kwargs['anchor']))
                return original_text(draw, xy, value, *args, **kwargs)
            def polygon(draw, points, *args, **kwargs):
                symbols.append((min(x for x, y in points), min(y for x, y in points), max(x for x, y in points), max(y for x, y in points)))
                return original_polygon(draw, points, *args, **kwargs)
            def shade(draw, xy, *args, **kwargs):
                shades.append(xy)
                return original_shade(draw, xy, *args, **kwargs)
            def rect(draw, xy, *args, **kwargs):
                if xy[2] - xy[0] < 2:
                    strips.append(xy)
                return original_rect(draw, xy, *args, **kwargs)
            with patch.object(ImageDraw.ImageDraw, 'text', text), patch.object(ImageDraw.ImageDraw, 'polygon', polygon), \
                    patch.object(ImageDraw.ImageDraw, 'rounded_rectangle', shade), patch.object(ImageDraw.ImageDraw, 'rectangle', rect):
                paper_map(image, dict(width=100), entries, '', options('paper', export_settings=dict(scale_bar=False)), entries if continuous else (), True)
            self.assertEqual(len(labels), 2)
            self.assertEqual(len(symbols), 2)
            centre = (shades[0][1] + shades[0][3]) / 2
            for box in labels + symbols + strips:
                self.assertAlmostEqual((box[1] + box[3]) / 2, centre, delta=.5)
            if continuous:
                self.assertLess(labels[0][2], symbols[0][0])
                self.assertLess(symbols[0][2], strips[0][0])
                self.assertLess(strips[-1][2], symbols[1][0])
                self.assertAlmostEqual((strips[0][0] + strips[-1][2]) / 2, (shades[0][0] + shades[0][2]) / 2)
                self.assertAlmostEqual(strips[0][0] - symbols[0][2], symbols[1][0] - strips[-1][2])
            else:
                self.assertFalse(strips)
                self.assertLess(symbols[0][2], labels[0][0])
                self.assertLess(labels[0][2], symbols[1][0])
            self.assertLess(symbols[1][2], labels[1][0])

    def test_shaded_hex_legend_flanks_ramp_and_omits_caption(self):
        image = Image.new('RGB', (1800, 900), (120, 120, 120))
        source = dict(width=100, pixel_x_nm=.1, name='private sample')
        entries = [('HCP', '#ff0000'), ('BCC', '#00ff00')]
        texts, polygons = [], []
        original_text, original_polygon = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.polygon
        def text(draw, xy, value, *args, **kwargs):
            texts.append((value, xy))
            return original_text(draw, xy, value, *args, **kwargs)
        def polygon(draw, points, *args, **kwargs):
            polygons.append(points)
            return original_polygon(draw, points, *args, **kwargs)
        with patch.object(ImageDraw.ImageDraw, 'text', text), patch.object(ImageDraw.ImageDraw, 'polygon', polygon):
            result = paper_map(image, source, entries, 'Match frequency · relative opacity', options('paper', 'transparent'), entries, True)
        self.assertEqual(result.size, (1800, 900))
        self.assertEqual([len(points) for points in polygons], [6, 6])
        self.assertEqual([value for value, _ in texts], ['HCP', 'BCC', '2 nm'])
        self.assertLess(texts[0][1][0], texts[1][1][0])
        self.assertTrue(all(32 <= xy[1] < 900 for _, xy in texts))
        # Shading blends into the opaque acquired image, never cuts a transparent hole.
        self.assertEqual(result.getpixel((70, 860))[3], 255)
        self.assertLess(result.getpixel((70, 860))[0], 120)
        self.assertEqual(result.getpixel((0, 0))[3], 255)
        self.assertEqual(image.getpixel((70, 860)), (120, 120, 120))
        triangle_entries = [*entries, ('FCC', '#0000ff')]
        triangle = paper_map(image, source, triangle_entries, '', options('paper', 'transparent'), triangle_entries, True)
        self.assertEqual(triangle.getchannel('A').getextrema(), (255, 255))

    def test_ternary_triangle_and_labels_are_balanced(self):
        image = Image.new('RGB', (1800, 900), 'grey')
        labels, symbols, shades, triangles = [], [], [], []
        original_text, original_polygon = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.polygon
        original_shade, original_composite = ImageDraw.ImageDraw.rounded_rectangle, Image.Image.alpha_composite
        def text(draw, xy, value, *args, **kwargs):
            labels.append(draw.textbbox(xy, value, font=kwargs['font'], anchor=kwargs['anchor']))
            return original_text(draw, xy, value, *args, **kwargs)
        def polygon(draw, points, *args, **kwargs):
            symbols.append((min(x for x, y in points), min(y for x, y in points), max(x for x, y in points), max(y for x, y in points)))
            return original_polygon(draw, points, *args, **kwargs)
        def shade(draw, xy, *args, **kwargs):
            shades.append(xy)
            return original_shade(draw, xy, *args, **kwargs)
        def composite(target, overlay, dest=(0, 0), *args, **kwargs):
            triangles.append((*dest, overlay.width, overlay.height))
            return original_composite(target, overlay, dest, *args, **kwargs)
        entries = [('HCP', '#79b8f8'), ('β (BCC) phase', '#00ff00'), ('FCC', '#ff0000')]
        with patch.object(ImageDraw.ImageDraw, 'text', text), patch.object(ImageDraw.ImageDraw, 'polygon', polygon), \
                patch.object(ImageDraw.ImageDraw, 'rounded_rectangle', shade), patch.object(Image.Image, 'alpha_composite', composite):
            paper_map(image, dict(width=100), entries, '', options('paper', 'transparent', dict(scale_bar=False)), entries, True)
        tx, ty, tw, th = triangles[0]
        self.assertAlmostEqual(tx + tw / 2, (shades[0][0] + shades[0][2]) / 2, delta=1)
        self.assertAlmostEqual(ty + th / 2, (shades[0][1] + shades[0][3]) / 2, delta=1)
        for label, symbol in zip(labels, symbols):
            self.assertAlmostEqual((label[1] + label[3]) / 2, (symbol[1] + symbol[3]) / 2, delta=.5)
        self.assertLess(labels[1][2], symbols[1][0])
        self.assertLess(symbols[0][2], labels[0][0])
        self.assertLess(symbols[2][2], labels[2][0])
        self.assertAlmostEqual((symbols[1][1] + symbols[1][3]) / 2, (symbols[2][1] + symbols[2][3]) / 2)

    def test_overlay_visibility_positions_and_validation(self):
        bounds = dict(x=32, y=32, width=1800, height=900)
        for corner in ('top-left', 'top-right', 'bottom-left', 'bottom-right'):
            theme = options('paper', export_settings=dict(legend_position=corner, scale_bar_position=corner))
            legend, bar = overlay_boxes(bounds, dict(width=700, height=150), dict(width=350, height=100), theme, 32)
            self.assertTrue(legend['y'] + 150 <= bar['y'] or bar['y'] + 100 <= legend['y'])
            self.assertEqual(legend['x'] > 900, corner.endswith('right'))
            self.assertGreaterEqual(bar['y'], 64)
            self.assertLessEqual(bar['y'] + 100, 900)
        image = Image.new('RGB', (1800, 900), 'grey')
        result = paper_map(image, dict(width=100, pixel_x_nm=.1), [('HCP', '#ff0000')], 'Do not render',
                           options('paper', 'transparent', dict(legend=False, scale_bar=False)))
        self.assertEqual(result.convert('RGB').tobytes(), image.tobytes())
        named = paper_map(image, dict(width=100, pixel_x_nm=.1, name='Sample'), [], '',
                          options('paper', 'transparent', dict(show_name=True, legend=False, scale_bar=False)))
        self.assertEqual(named.size, (1800, 1044))
        self.assertEqual(named.getpixel((0, 0))[3], 0)
        self.assertEqual(named.crop((0, 144, 1800, 1044)).convert('RGB').tobytes(), image.tobytes())
        for settings in ({'legend_position': 'centre'}, {'legend_colour': 'red'}, {'text_scale': 0}, {'legend_opacity': float('nan')}, {'scale_bar': 'false'}):
            with self.assertRaises(ValueError):
                png_exports(dict(export_png=True, png_settings=settings), ['HCP'])

    def test_batch_uses_overlay_settings_in_both_styles(self):
        job = stability_tests.StabilityBatch().job()
        stream = BytesIO()
        Image.new('RGB', (100, 100), 'grey').save(stream, 'PNG')
        with TemporaryDirectory() as directory:
            for style in ('paper', 'standard'):
                path = Path(directory) / (style + '.png')
                map_png(dict(preview=stream.getvalue()), job, path, style=style, background='transparent',
                        export_settings=dict(show_name=False, legend=False, scale_bar=False))
                with Image.open(path) as rendered:
                    self.assertEqual(rendered.size, (1800, 1800))
                    self.assertEqual(rendered.getpixel((0, 0))[3], 255)

    def test_paper_names_scale_colours_alpha_and_unchanged_results(self):
        job = stability_tests.StabilityBatch().job()
        job['source']['name'] = 'private-sample-name'
        before = copy.deepcopy(job)
        stream = BytesIO()
        Image.new('RGB', (100, 100), (120, 120, 120)).save(stream, 'PNG')
        original_text = ImageDraw.ImageDraw.text
        with TemporaryDirectory() as directory:
            for background in ('white', 'dark', 'transparent'):
                recorded = []
                def record(draw, xy, text, *args, **kwargs):
                    recorded.append((text, kwargs.get('font')))
                    return original_text(draw, xy, text, *args, **kwargs)
                path = Path(directory) / (background + '.png')
                with patch.object(ImageDraw.ImageDraw, 'text', record):
                    map_png(dict(preview=stream.getvalue()), job, path, opacity=1, style='paper', background=background)
                texts = [text for text, _ in recorded]
                self.assertNotIn('private-sample-name', texts)
                self.assertIn('2 nm', texts)
                self.assertFalse(any('opacity' in text or 'Match frequency' in text or '0–100%' in text for text in texts))
                self.assertTrue(all(font.size >= 44 for _, font in recorded))
                with Image.open(path) as image:
                    corner = image.convert('RGBA').getpixel((0, 0))
                    self.assertEqual(corner[3], 255)
                    self.assertEqual(image.size, (1800, 1800))
                    self.assertEqual(image.convert('RGBA').getchannel('A').getextrema(), (255, 255))
                    self.assertEqual(image.convert('RGBA').getpixel((1700, 500)), (120, 120, 120, 255))
                    self.assertLessEqual(max(image.size), 3200)
                self.assertEqual(job, before)

    def test_standard_style_still_shows_name_and_all_backgrounds_work(self):
        job = stability_tests.StabilityBatch().job()
        stream = BytesIO()
        Image.new('RGB', (100, 100), 'grey').save(stream, 'PNG')
        with TemporaryDirectory() as directory:
            for mode in ('overlap', 'standard'):
                job['grid']['mode'] = mode
                for background in ('white', 'dark', 'transparent'):
                    path = Path(directory) / f'{mode}-{background}.png'
                    map_png(dict(preview=stream.getvalue()), job, path, style='standard', background=background)
                    with Image.open(path) as image:
                        self.assertEqual(image.mode, 'RGBA' if background == 'transparent' else 'RGB')
                        alpha = image.convert('RGBA')
                        self.assertEqual(alpha.getpixel((0, 0))[3], 0 if background == 'transparent' else 255)
                        self.assertEqual(alpha.getpixel((500, 500))[3], 255)

    def test_rectangular_uniform_grid_keeps_paper_aspect_and_large_labels(self):
        job = stability_tests.StabilityBatch().job()
        job['grid']['mode'] = 'standard'
        job['source']['width'] = 200
        stream = BytesIO()
        Image.new('RGB', (200, 100), (120, 120, 120)).save(stream, 'PNG')
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'paper.png'
            map_png(dict(preview=stream.getvalue()), job, path, style='paper')
            with Image.open(path) as image:
                self.assertEqual(image.size, (1800, 900))
                self.assertLess(image.height, 1400)
                self.assertEqual(image.getpixel((1700, 500)), (120, 120, 120))

    def test_validation_and_physical_scale(self):
        self.assertEqual(scale_bar(1800, 10000), (360, '2 µm'))
        for value in (None, 0, -1, float('nan')):
            self.assertIsNone(scale_bar(1800, value))
        for choice in ({'png_style': 'invalid'}, {'png_background': 'invalid'}):
            with self.assertRaises(ValueError):
                png_exports({'export_png': True, **choice}, ['HCP'])


if __name__ == '__main__':
    unittest.main()
