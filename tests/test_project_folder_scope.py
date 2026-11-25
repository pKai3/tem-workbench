"""One project has shared exclusions and independently narrowed mode scopes."""
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

import numpy as np
from PIL import Image

from tem_workbench.app.engine import Engine
from tem_workbench.app.server import Workbench
from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.figures.relocation import FigureSourceResolver
from tem_workbench.figures.creator import _digest
from tem_workbench.storage.folder_paths import save_sources, resolve_config, clean_folder_rules, clean_folder_modes, output_folder, source_roots, folder_scope


class ProjectFolderScopeTests(unittest.TestCase):
    def test_explicit_export_inclusion_is_per_mode_and_preserves_child_scope(self):
        from tem_workbench.storage.mode_folders import scan_folders
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            output = root / 'results' / 'exports'
            for relative in ['source.tif', 'results/exports/a.tif', 'results/exports/chosen/b.tif']:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'fixture')
            source = {'path': str(root), 'folder_modes': {'results/exports': {'figures': True}}}
            def files(mode):
                return {name for _, names in scan_folders(root, [output], scope=folder_scope(source, mode)) for name in names}
            self.assertEqual(files('figures'), {'source.tif', 'a.tif', 'b.tif'})
            self.assertEqual(files('tem'), {'source.tif'})
            source['folder_modes']['results/exports']['figures'] = False
            source['folder_modes']['results/exports/chosen'] = {'figures': True}
            self.assertEqual(files('figures'), {'source.tif', 'b.tif'})
            source['folder_modes'] = {'.': {'figures': True}}
            self.assertEqual(files('figures'), {'source.tif'}, 'Broad inclusion must not silently include exports')

    def test_all_modes_share_ignores_and_mode_includes_narrow_the_tree(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();paper=root/'paper'
            images=['TEM/ST/a.tif','TEM/STA/b.tif','TEM/ST/rejected/c.tif','SEM Imaging/d.tif',
                    'Archive/e.tif','TEM/Analysis/export.tif','other/f.tif']
            for index,name in enumerate(images):
                path=paper/name;path.parent.mkdir(parents=True,exist_ok=True)
                Image.fromarray((np.arange(4096).reshape(64,64)+index).astype('uint16')).save(path)
            for name in ['SEM EDS & EBSD/EDX/one.h5oina','SEM EDS & EBSD/rejected/two.h5oina','Archive/three.h5oina','other/wrong.h5oina']:
                path=paper/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture')
            rules={'all':{'include':['TEM','SEM Imaging','SEM EDS & EBSD','Archive'],'ignore':['Archive','TEM/Analysis']},
                   'tem':{'include':['TEM'],'ignore':['TEM/ST/rejected']},
                   'aztec':{'include':['SEM EDS & EBSD'],'ignore':['SEM EDS & EBSD/rejected']},
                   'figures':{'include':['TEM','SEM Imaging'],'ignore':[]}}
            config=save_sources(root/'config.json',root,{},[dict(id='paper',name='Paper',path=str(paper),
                                output=str(paper/'Analysis'),folder_rules=rules)],root/'output')
            config=resolve_config(config,root);engine=Engine(config);engine.catalog()
            self.assertEqual({Path(row['path']).name for row in engine.file_rows.values()},{'a.tif','b.tif'})
            browser=AztecBrowser();files=browser.files(config['sources'])['files']
            self.assertEqual([Path(row['path']).name for row in files],['one.h5oina'])
            listing=browser.browse(paper,root,config['sources'],'paper')
            self.assertEqual([row['name'] for row in listing['directories']],['SEM EDS & EBSD'])
            self.assertEqual(browser.browse(paper/'Archive',root,config['sources'],'paper')['files'],[])
            app=SimpleNamespace(config=config,engine=engine,figure_resolver=FigureSourceResolver())
            app.figure_sources=lambda body:Workbench.figure_sources(app,body)
            figures=Workbench.figure_listing(app,{})['images']
            self.assertEqual({Path(row['path']).name for row in figures},{'a.tif','b.tif','c.tif','d.tif'})
            missing=dict(path=str(paper/'missing.tif'),sha256=_digest(paper/'Archive/e.tif'),source_project='paper')
            recovery=Workbench.reconnect_figure_sources(app,dict(slots=[missing]))
            self.assertEqual(recovery['repairs'],[])
            self.assertFalse(recovery['issues'][0]['custom_folder'])
            # Explicit custom folders remain an intentional, separate source scope.
            self.assertEqual(len(Workbench.figure_listing(app,dict(folder=str(paper/'Archive')))['images']),1)

    def test_multiple_roots_share_identity_outputs_scopes_and_relocation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();first=root/'first';second=root/'second'
            for index,path in enumerate([first/'ST/a.tif',second/'STA/b.tif',second/'ignored/c.tif',second/'out/export.tif']):
                path.parent.mkdir(parents=True,exist_ok=True)
                Image.fromarray((np.arange(4096).reshape(64,64)+index).astype('uint16')).save(path)
            for path in [first/'aztec/a.h5oina',second/'aztec/b.h5oina',second/'ignored/c.h5oina']:
                path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture')
            sources=[dict(id='paper',name='Paper',path=str(first),output=str(second/'out'),folders=[
                dict(path=str(first)),dict(path=str(second),folder_modes={'ignored':dict(tem=False,aztec=False,figures=False)})])]
            config=resolve_config(save_sources(root/'config.json',root,{},sources,root/'fallback'),root)
            engine=Engine(config);engine.catalog()
            rows=list(engine.file_rows.values());self.assertEqual({Path(row['path']).name for row in rows},{'a.tif','b.tif'})
            original=next(row for row in rows if row['name']=='a');self.assertTrue(engine.allowed_path(second/'STA/b.tif'))
            self.assertEqual(engine.output_for(original['id']),second/'out')
            self.assertEqual(output_folder(config['sources'],root/'fallback',path=second/'aztec/b.h5oina'),second/'out')
            browser=AztecBrowser();self.assertEqual({Path(row['path']).name for row in browser.files(config['sources'],'paper')['files']},{'a.h5oina','b.h5oina'})
            self.assertEqual(len(browser.browse('',root,config['sources'],'paper')['directories']),2)
            app=SimpleNamespace(config=config,engine=engine,figure_resolver=FigureSourceResolver())
            app.figure_sources=lambda body:Workbench.figure_sources(app,body)
            self.assertEqual({Path(row['path']).name for row in Workbench.figure_listing(app,{'project':'paper'})['images']},{'a.tif','b.tif'})
            old=first/'ST/a.tif';ref=dict(path=str(old),sha256=_digest(old),source_project='paper')
            moved=second/'STA/renamed.tif';old.rename(moved);engine.catalog()
            self.assertEqual(engine.file_rows[original['id']]['path'],str(moved))
            repairs=Workbench.reconnect_figure_sources(app,dict(slots=[ref]))['repairs']
            self.assertEqual(repairs[0]['after']['path'],str(moved));self.assertEqual(repairs[0]['after']['source_project'],'paper')
            self.assertEqual({row['source_id'] for row in engine.file_rows.values()},{'paper'})
            self.assertEqual(len(config['sources']),1)

    def test_mode_table_defaults_and_subtree_overrides(self):
        from tem_workbench.storage.mode_folders import scan_folders, aztec_folders
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()
            for name in ['a/top.oipx','a/keep/one.oipx','a/skip/two.oipx','new/new.oipx']:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.touch()
            folder=dict(path=str(root),folder_modes={'a':{'tem':False,'aztec':False},'a/keep':{'aztec':True}})
            scan=lambda mode:{str((directory/name).relative_to(root)) for directory,names in scan_folders(root,scope=folder_scope(folder,mode)) for name in names}
            self.assertEqual(scan('tem'),{'new/new.oipx'})
            self.assertEqual(scan('aztec'),{'a/keep/one.oipx','new/new.oipx'})
            self.assertEqual(len(scan('figures')),4)
            self.assertIn(root/'a/keep',aztec_folders(root,scope=folder_scope(folder,'aztec')))
            folder['folder_modes']['a/keep']['aztec']=False
            self.assertNotIn(root/'a/keep',aztec_folders(root,scope=folder_scope(folder,'aztec')))
            for values in [{'../escape':{'tem':False}},{'.':{'tem':'false'}},{'.':{'wrong':False}}]:
                with self.assertRaises(ValueError):clean_folder_modes(values,root)

    def test_multiple_root_validation_is_atomic(self):
        import json
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();first=root/'first';second=root/'second';first.mkdir();second.mkdir()
            path=root/'config.json';original=save_sources(path,root,{},[dict(name='Paper',path=str(first))],root/'out')
            for folders in [[],[dict(path=str(first)),dict(path=str(first))],[dict(path=str(first)),dict(path=str(root))],[dict(path=str(second/'missing'))]]:
                with self.assertRaises(ValueError):save_sources(path,root,original,[dict(name='Paper',folders=folders)],root/'out')
                self.assertEqual(json.loads(path.read_text()),original)
            with self.assertRaises(ValueError):save_sources(path,root,original,[dict(name='Paper',folders=[dict(path=str(first)),dict(path=str(second))],output=str(second))],root/'out')

    def test_missing_included_folder_does_not_fall_back_to_whole_project(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();Image.new('RGB',(40,40),'red').save(root/'unrelated.png')
            source=dict(id='paper',name='Paper',path=str(root),folder_rules={'figures':{'include':['moved-away']}})
            app=SimpleNamespace(engine=SimpleNamespace(sources=[source]),config={'output_root':str(root/'out')})
            app.figure_sources=lambda body:Workbench.figure_sources(app,body)
            self.assertEqual(Workbench.figure_listing(app,{})['images'],[])

    def test_folder_rules_reject_absolute_escape_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();project=root/'project';project.mkdir()
            (project/'linked').symlink_to(root,target_is_directory=True)
            for path in ['../outside',str(root),'linked']:
                with self.assertRaisesRegex(ValueError,'inside their project'):
                    clean_folder_rules({'tem':{'include':[path]}},project)
            self.assertEqual(clean_folder_rules({'tem':{'include':['ST','ST','STA']}},project)['tem']['include'],['ST','STA'])


if __name__=='__main__':unittest.main()
