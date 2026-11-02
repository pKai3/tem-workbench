import csv
from pathlib import Path
import tempfile
import unittest
from batch_grids import summary_folder, folder_summaries, write_folder_csv, BatchGrids
import test_batch_stability
import test_manual_batch

class FolderSummaries(unittest.TestCase):
    def test_parent_union_and_top_level_flatten(self):
        roots=['ST','STA','ST/nested']
        self.assertEqual(summary_folder('ST/nested/file.dm4',roots,True),'ST')
        self.assertEqual(summary_folder('STA/deeper/file.dm4',roots,True),'STA')
        self.assertEqual(summary_folder('ST/nested/file.dm4',roots,False),'ST/nested')
        self.assertEqual(summary_folder('ST/nested/file.dm4',[],True),'ST')
        self.assertEqual(summary_folder('file.dm4',[],True),'.')
        self.assertEqual(summary_folder('STOther/file.dm4',['ST'],True),'STOther')

    def test_folder_csv_both_modes(self):
        from batch_grids import summarize
        for overlap in [False,True]:
            with self.subTest(overlap=overlap),tempfile.TemporaryDirectory() as tmp:
                job=test_batch_stability.StabilityBatch().job() if overlap else test_manual_batch.BatchSummaries().job()
                rows=[]
                for key in ['ST/one/a.dm4','ST/two/b.dm4','STA/one/c.dm4']:
                    row=summarize(job,'ST' if key.startswith('ST/') else 'STA')
                    row.update(file_id=key,source_folder=summary_folder(key,[],False),summary_folder=summary_folder(key,['ST','STA'],True))
                    rows.append(row)
                groups=folder_summaries(rows)
                self.assertEqual([g['folder'] for g in groups],['ST','STA'])
                self.assertEqual(groups[0]['images'],2)
                data=dict(images=rows,folders=groups,options={'overlap':{} if overlap else None})
                folder=Path(tmp);write_folder_csv(folder,data,BatchGrids.csv)
                with (folder/'folders.csv').open() as f:
                    output=list(csv.DictReader(f));self.assertEqual(output[0]['folder'],'ST')
                    self.assertIn('pooled_support_percent' if overlap else 'pooled_image_percent',output[0])
                self.assertTrue((folder/'folder_zones.csv').is_file())
                with (folder/'image_folders.csv').open() as f:self.assertEqual(len(list(csv.DictReader(f))),3)
                for row in rows:row['summary_folder']=row['source_folder']
                self.assertEqual(len(folder_summaries(rows)),3)

if __name__=='__main__':unittest.main()
