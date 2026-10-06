import csv
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from pipeline.data import ACCOUNT_HEADER, TX_HEADER, FILES, DataError, download, main, profile, unpack_download


class DataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.row = ['2022/09/01 00:00', '010', '000A', '020', '000B',
                    '1.000000', 'Bitcoin', '1.000000', 'Bitcoin', 'ACH', '1']
        self.write_csv(FILES[0], TX_HEADER, [self.row, self.row[:10] + ['0']])
        self.write_csv(FILES[1], ACCOUNT_HEADER,
                       [['Bank A', '010', '000A', 'E1', 'Entity A']])
        self.write_patterns()

    def write_csv(self, name, header, rows):
        with (self.root / name).open('w', newline='') as output:
            writer = csv.writer(output)
            writer.writerow(header)
            writer.writerows(rows)

    def write_patterns(self, typology='FAN-IN', ending=None, row=None):
        stream = io.StringIO()
        csv.writer(stream).writerow(row or self.row)
        (self.root / FILES[2]).write_text(
            f'BEGIN LAUNDERING ATTEMPT - {typology}\n{stream.getvalue()}'
            f'END LAUNDERING ATTEMPT - {ending or typology}\n')

    def test_profile_is_deterministic_and_preserves_schema(self):
        result = profile(self.root)
        self.assertEqual(result, profile(self.root))
        self.assertEqual(result['files'][FILES[0]]['rows'], 2)
        self.assertEqual(result['files'][FILES[0]]['columns'].count('Account'), 2)
        self.assertEqual(result['enabled_typologies'], ['FAN-IN'])
        self.assertEqual(result['labels'], {'0': 1, '1': 1})
        self.assertEqual(len(result['files'][FILES[0]]['sha256']), 64)

    def test_random_and_unknown_are_not_enabled(self):
        for typology in ('RANDOM', 'NEW-PATTERN'):
            self.write_patterns(typology)
            result = profile(self.root)
            self.assertEqual(result['enabled_typologies'], [])
            self.assertEqual(result['unsupported_typologies'], [typology])

    def test_missing_file(self):
        (self.root / FILES[1]).unlink()
        with self.assertRaisesRegex(DataError, 'Missing'):
            profile(self.root)

    def test_bad_headers(self):
        for name, header in ((FILES[0], TX_HEADER), (FILES[1], ACCOUNT_HEADER)):
            with self.subTest(name=name):
                path = self.root / name
                original = path.read_text()
                self.write_csv(name, header[::-1], [])
                with self.assertRaisesRegex(DataError, 'unexpected header'):
                    profile(self.root)
                path.write_text(original)

    def test_bad_transactions(self):
        for index, value in ((0, 'not-a-date'), (5, 'NaN'), (7, '-1'), (10, '2')):
            row = self.row.copy()
            row[index] = value
            self.write_csv(FILES[0], TX_HEADER, [row])
            with self.subTest(index=index), self.assertRaises(DataError):
                profile(self.root)

    def test_malformed_patterns(self):
        path = self.root / FILES[2]
        original = path.read_text()
        for text in ('', original.split('END')[0], original.replace('END LAUNDERING ATTEMPT - FAN-IN', 'END LAUNDERING ATTEMPT - CYCLE'),
                     'junk\n' + original, original.replace('2022/', 'BEGIN LAUNDERING ATTEMPT - CYCLE\n2022/')):
            path.write_text(text)
            with self.subTest(text=text), self.assertRaises(DataError):
                profile(self.root)

    def test_pattern_rows_must_match_exact_source_values(self):
        row = self.row.copy()
        row[5] = '1.00'
        self.write_patterns(row=row)
        with self.assertRaisesRegex(DataError, 'do not match'):
            profile(self.root)

    def test_manifest_only_written_after_validation(self):
        output = self.root / 'manifest.json'
        args = ['profile', '--data-dir', str(self.root), '--manifest', str(output)]
        self.assertEqual(main(args), 0)
        previous = output.read_text()
        self.assertEqual(json.loads(previous)['schema_version'], 1)
        (self.root / FILES[2]).write_text('invalid')
        with patch('sys.stderr', new_callable=io.StringIO):
            self.assertEqual(main(args), 1)
        self.assertEqual(output.read_text(), previous)

    @patch.dict(os.environ, {}, clear=True)
    def test_missing_credentials_before_network_or_writes(self):
        target = self.root / 'absent'
        with patch('pipeline.data.subprocess.run') as run:
            with self.assertRaisesRegex(DataError, 'KAGGLE_USERNAME'):
                download(target)
            run.assert_not_called()
        self.assertFalse(target.exists())

    @patch.dict(os.environ, {'KAGGLE_USERNAME': 'test-user', 'KAGGLE_KEY': 'test-secret'})
    @patch('pipeline.data.shutil.which', return_value='/test/kaggle')
    def test_download_stages_and_validates(self, _which):
        def fake_download(command, **kwargs):
            name = command[command.index('-f') + 1]
            destination = Path(command[command.index('-p') + 1])
            (destination / name).write_bytes((self.root / name).read_bytes())
            self.assertNotIn('test-secret', command)
            self.assertEqual(kwargs['env']['KAGGLE_CONFIG_DIR'], str(destination / '.kaggle'))
            return type('Result', (), {'returncode': 0})()
        target = self.root / 'download'
        with patch('pipeline.data.subprocess.run', side_effect=fake_download) as run:
            download(target)
            self.assertEqual(run.call_count, 3)
        self.assertEqual(profile(target), profile(self.root))

    def test_single_file_zip(self):
        target = self.root / 'archive'
        target.mkdir()
        with zipfile.ZipFile(target / (FILES[0] + '.zip'), 'w') as archive:
            archive.writestr(FILES[0], (self.root / FILES[0]).read_bytes())
        unpack_download(target, FILES[0])
        self.assertEqual((target / FILES[0]).read_bytes(), (self.root / FILES[0]).read_bytes())

    def test_zip_rejects_unexpected_paths(self):
        target = self.root / 'archive'
        target.mkdir()
        with zipfile.ZipFile(target / (FILES[0] + '.zip'), 'w') as archive:
            archive.writestr('../unexpected.csv', 'bad')
        with self.assertRaisesRegex(DataError, 'exactly the requested file'):
            unpack_download(target, FILES[0])
        self.assertFalse((self.root / 'unexpected.csv').exists())

    @patch.dict(os.environ, {'KAGGLE_USERNAME': 'test-user', 'KAGGLE_KEY': 'test-secret'})
    @patch('pipeline.data.shutil.which', return_value='/test/kaggle')
    def test_failed_download_preserves_existing_files(self, _which):
        original = (self.root / FILES[0]).read_bytes()
        with patch('pipeline.data.subprocess.run') as run:
            run.return_value.returncode = 1
            with self.assertRaisesRegex(DataError, 'Kaggle download failed'):
                download(self.root)
        self.assertEqual((self.root / FILES[0]).read_bytes(), original)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), sorted(FILES))


if __name__ == '__main__':
    unittest.main()
