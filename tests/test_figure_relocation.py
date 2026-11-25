"""Moved figure sources retain recipes; changed or ambiguous bytes never substitute."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from PIL import Image

from tem_workbench.figures import creator
from tem_workbench.figures.relocation import FigureSourceResolver, source_reference


class FigureRelocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.old = self.root / 'old'
        self.old.mkdir()
        self.path = self.old / 'image.tif'
        Image.new('RGB', (140, 100), '#567890').save(self.path)
        self.slot = dict(path=str(self.path), name=self.path.name, sha256=creator._digest(self.path),
                         label='My label', width=140, height=100, content_height=95,
                         scale_mode='metadata', pixel_size_nm=2, zoom=1.2, center_x=.4, center_y=.6,
                         brightness=1.2, contrast=.9, sharpness=1.1, label_colour='#123456',
                         metadata={'magnification': {'value': 8000, 'source': 'Manual'}},
                         annotations=[dict(type='text', x=.4, y=.3, text='Keep me', color='#ffffff', size=20)])
        self.resolver = FigureSourceResolver()

    def move(self, name='renamed.tif'):
        target = self.root / 'new' / 'nested' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        self.path.rename(target)
        return target

    def resolve(self, slots=None, root=None, outputs=()):
        return self.resolver.resolve(slots or [self.slot], [(root or self.root, outputs)])

    @staticmethod
    def apply(slot, result):
        restored = copy.deepcopy(slot)
        after = result['repairs'][0]['after']
        restored.update({key: after[key] for key in ('path', 'name')})
        for key in ('metadata_sidecar', 'analysis'):
            if key in after:
                restored[key]['path'] = after[key]['path']
        return restored

    def test_directory_and_file_rename_preserves_render_and_all_edits(self):
        for key, suffix in [('metadata_sidecar', '.txt'), ('analysis', '.json')]:
            path = self.path.with_suffix(suffix)
            path.write_text('original provenance')
            self.slot[key] = dict(path=str(path), sha256=creator._digest(path), extra='retained')
        recipe = dict(columns=1, aspect='auto', slots=[self.slot], image_padding=12)
        original = creator.render(recipe)
        before = copy.deepcopy(self.slot)
        target = self.move()
        for suffix in ('.txt', '.json'):
            self.path.with_suffix(suffix).rename(target.with_suffix(suffix))
        result = self.resolve()
        self.assertEqual(result['issues'], [])
        self.assertEqual(len(result['repairs']), 1)
        self.assertEqual(result['repairs'][0]['before'], source_reference(self.slot))
        restored = self.apply(self.slot, result)
        self.assertEqual(creator.render({**recipe, 'slots': [restored]}), original)
        self.assertEqual(self.slot, before, 'Resolving never mutates its input or saved edits')
        for key in before.keys() - {'path', 'name', 'metadata_sidecar', 'analysis'}:
            self.assertEqual(restored[key], before[key])
        self.assertEqual(restored['metadata_sidecar']['extra'], 'retained')

    def test_changed_existing_file_does_not_reconnect_to_original_copy(self):
        shutil.copy(self.path, self.root / 'copy.tif')
        self.path.write_bytes(b'edited image')
        result = self.resolve()
        self.assertEqual(result['repairs'], [])
        self.assertEqual(result['issues'][0]['kind'], 'changed')

    def test_duplicate_matches_need_a_narrower_folder(self):
        target = self.move()
        shutil.copy(target, self.root / 'copy.tif')
        result = self.resolve()
        self.assertEqual(result['repairs'], [])
        self.assertEqual(result['issues'][0]['kind'], 'ambiguous')
        self.assertEqual(self.resolve(root=target.parent)['repairs'][0]['after']['path'], str(target))

    def test_existing_exact_path_wins_over_duplicates(self):
        shutil.copy(self.path, self.root / 'copy.tif')
        self.assertEqual(self.resolve()['issues'], [])
        self.assertEqual(self.resolve()['repairs'], [])

    def test_companion_failure_never_partially_relinks_a_panel(self):
        txt = self.path.with_suffix('.txt'); txt.write_text('provenance')
        self.slot['metadata_sidecar'] = dict(path=str(txt), sha256=creator._digest(txt))
        target = self.move()
        result = self.resolve()
        self.assertEqual(result['repairs'], [])
        self.assertEqual(result['issues'][0]['kind'], 'missing_companion')
        target.with_suffix('.txt').write_text('different provenance')
        result = self.resolve()
        self.assertEqual(result['repairs'], [])
        self.assertEqual(result['issues'][0]['kind'], 'changed_companion')
        shutil.copy(txt, target.with_suffix('.txt'))
        self.assertEqual(self.resolve()['issues'], [])

    def test_companion_only_relocation_and_analysis_original_location(self):
        txt = self.path.with_suffix('.txt'); txt.write_text('provenance')
        self.slot['metadata_sidecar'] = dict(path=str(self.root / 'missing.txt'), sha256=creator._digest(txt))
        analysis = self.root / 'original-analysis.json'; analysis.write_text('{}')
        self.slot['analysis'] = dict(path=str(analysis), sha256=creator._digest(analysis))
        result = self.resolve()
        restored = self.apply(self.slot, result)
        self.assertEqual(restored['metadata_sidecar']['path'], str(txt))
        self.assertEqual(restored['analysis']['path'], str(analysis))

    def test_paired_legacy_png_is_not_hidden_from_recovery(self):
        png = self.old / 'legacy.png'; Image.new('RGB', (80, 60), 'blue').save(png)
        slot = dict(path=str(png), sha256=creator._digest(png))
        target = self.root / 'renamed.png'; png.rename(target)
        target.with_suffix('.dm4').write_bytes(b'original DM4')
        result = self.resolve([slot])
        self.assertEqual(result['issues'], [])
        self.assertEqual(result['repairs'][0]['after']['path'], str(target))

    def test_native_dm4_and_tiff_extension_aliases(self):
        native = self.old / 'native.dm4'; native.write_bytes(b'original DM4')
        native_slot = dict(path=str(native), sha256=creator._digest(native))
        moved_native = self.root / 'new.dm4'; native.rename(moved_native)
        target = self.move('image.tiff')
        result = self.resolve([self.slot, native_slot, {}, dict(kind='placeholder')])
        self.assertEqual(result['issues'], [])
        self.assertEqual({r['after']['path'] for r in result['repairs']}, {str(target), str(moved_native)})

    def test_missing_hash_and_matching_name_never_guess_identity(self):
        self.move()
        self.path.write_bytes(b'different')
        result = self.resolve([{**self.slot, 'sha256': None}])
        self.assertEqual(result['repairs'], [])
        self.assertEqual(result['issues'][0]['kind'], 'missing_hash')

    def test_output_exclusions_and_aliases_but_explicit_folder_allowed(self):
        target = self.move()
        (self.root / 'alias.tif').symlink_to(target)
        result = self.resolve(outputs=[target.parent])
        self.assertEqual(result['repairs'], [])
        self.assertEqual(result['issues'][0]['kind'], 'missing')
        self.assertEqual(len(self.resolve(root=target.parent)['repairs']), 1)

    def test_file_alias_cannot_expand_search_beyond_selected_root(self):
        target = self.move()
        (self.old / 'alias.tif').symlink_to(target)
        result = self.resolve(root=self.old)
        self.assertEqual(result['repairs'], [])
        self.assertEqual(result['issues'][0]['kind'], 'missing')

    def test_cache_invalidates_changed_file_and_overlapping_roots_deduplicate(self):
        target = self.move()
        roots = [(self.root, ()), (target.parent, ())]
        self.assertEqual(len(self.resolver.resolve([self.slot, self.slot], roots)['repairs']), 1)
        with patch('tem_workbench.figures.relocation._digest', side_effect=AssertionError('Should reuse unchanged bytes')):
            self.assertEqual(len(self.resolver.resolve([self.slot], roots)['repairs']), 1)
        target.write_bytes(b'different bytes')
        self.assertEqual(self.resolver.resolve([self.slot], roots)['issues'][0]['kind'], 'missing')

    def test_incomplete_search_does_not_guess_uniqueness(self):
        self.move()
        unreadable = self.root / 'unreadable.tif'; unreadable.write_bytes(b'no access')
        original = self.resolver._hash
        def digest(path):
            if path == unreadable:
                raise PermissionError('Unavailable source')
            return original(path)
        with patch.object(self.resolver, '_hash', side_effect=digest):
            result = self.resolve()
        self.assertEqual(result['repairs'], [])
        self.assertEqual(result['issues'][0]['kind'], 'incomplete_search')

    def test_server_uses_configured_and_chosen_folders_without_ancestor_guessing(self):
        from tem_workbench.app.server import Workbench
        target = self.move()
        app = SimpleNamespace(figure_resolver=self.resolver,
                              engine=SimpleNamespace(sources=[dict(id='one', path=str(self.old), output='')]),
                              config=dict(output_root=str(self.root / 'output')))
        body = dict(slots=[self.slot])
        self.assertEqual(Workbench.reconnect_figure_sources(app, body)['issues'][0]['kind'], 'missing')
        for options in ({'search_folder': str(target.parent)},
                        {'folder': str(target.parent)}):
            result = Workbench.reconnect_figure_sources(app, {**body, **options})
            self.assertEqual(result['issues'], [])
            self.assertEqual(result['repairs'][0]['after']['path'], str(target))
        # A previous explicit recovery location is not a permanent search scope.
        result = Workbench.reconnect_figure_sources(app, {**body, 'folders': [str(target.parent)]})
        self.assertEqual(result['repairs'], [])
        self.assertEqual(result['issues'][0]['kind'], 'missing')
        # Nor may a saved source path silently grant its old directory as scope.
        another = self.old / 'renamed.tif'; target.rename(another)
        app.engine.sources = []
        self.assertEqual(Workbench.reconnect_figure_sources(app, body)['issues'][0]['kind'], 'missing')
        with self.assertRaisesRegex(ValueError, 'available source folder'):
            Workbench.reconnect_figure_sources(app, {**body, 'search_folder': str(self.root / 'gone')})

    def test_cross_project_move_recovers_even_when_browser_filters_original_project(self):
        from tem_workbench.app.server import Workbench
        target = self.move()
        self.slot['source_project'] = 'before'
        app = SimpleNamespace(figure_resolver=self.resolver,
                              engine=SimpleNamespace(sources=[dict(id='before', path=str(self.old)),
                                                               dict(id='after', path=str(target.parent))]),
                              config=dict(output_root=str(self.root / 'output')))
        result = Workbench.reconnect_figure_sources(app, dict(slots=[self.slot], project='before'))
        self.assertEqual(result['issues'], [])
        self.assertEqual(result['repairs'][0]['after']['source_project'], 'after')

    def test_all_projects_listing_processing_and_old_output_exclusion(self):
        from tem_workbench.app.server import Workbench
        from tem_workbench.storage import folder_paths
        from tem_workbench.figures.index import FigureMetadataIndex
        second = self.root / 'second'; second.mkdir()
        Image.new('RGB', (80, 60), 'red').save(second / 'other.png')
        old_output = self.old / 'Analysis'; old_output.mkdir()
        Image.new('RGB', (80, 60), 'blue').save(old_output / 'export.png')
        sources = [dict(id='one', name='TEM', path=str(self.old), output=str(old_output)),
                   dict(id='two', name='SEM', path=str(second), output='')]
        app = SimpleNamespace(engine=SimpleNamespace(sources=sources), config=dict(output_root=str(self.root/'fallback')))
        app.figure_sources = lambda body: Workbench.figure_sources(app, body)
        all_images = Workbench.figure_listing(app, {})
        self.assertEqual(len(all_images['images']), 2)
        self.assertEqual({row['folder'] for row in all_images['images']}, {'TEM', 'SEM'})
        self.assertEqual(len(Workbench.figure_listing(app, dict(project='one'))['images']), 1)
        with self.assertRaisesRegex(ValueError, 'configured project'):
            Workbench.figure_listing(app, dict(project='missing'))
        with self.assertRaisesRegex(ValueError, 'available image folder'):
            Workbench.figure_listing(app, dict(folder=''))
        index = FigureMetadataIndex(self.root/'index.json')
        index.start(None, workers=2, image_loader=lambda: all_images['images'])
        index.thread.join(timeout=15)
        self.assertEqual(index.status()['done'], 2)
        self.assertEqual(len(index.status(folders=[self.old, second])['records']), 2)
        merged = folder_paths.save_sources(self.root/'config.json', self.root,
            dict(sources=sources, output_root=str(self.root/'fallback')),
            [dict(id='one', name='Paper', path=str(self.root), output=str(self.root/'Analysis'))], self.root/'Analysis')
        self.assertIn(str(old_output), merged['sources'][0]['excluded_outputs'])
        app.engine.sources = merged['sources']; app.config = merged
        self.assertEqual(len(Workbench.figure_listing(app, {})['images']), 2)


if __name__ == '__main__':
    unittest.main()
