import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile
import stat

spec = importlib.util.spec_from_file_location('patch', Path(__file__).resolve().parents[1] / 'scripts/apply_zip_patch.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


class ZipPatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / 'patch.zip'

    def make(self, files):
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name, body in files.items():
                archive.writestr(name, body)

    def test_root_and_wrapper(self):
        for prefix in ['', 'Cloudbank-main/']:
            self.make({prefix + 'providers/new.js': 'test'})
            self.assertEqual(patch.apply_zip(self.archive, self.root), 1)
            self.assertEqual((self.root / 'providers/new.js').read_text(), 'test')
            self.assertFalse((self.root / 'Cloudbank-main').exists())

    def test_unsafe_paths(self):
        for name in ['../escape', '/escape', '.git/config', 'wrapper/.git/config', 'providers\\evil.js']:
            self.make({'providers/good.js': 'good', name: 'bad'})
            with self.assertRaises(ValueError):
                patch.apply_zip(self.archive, self.root)
            self.assertFalse((self.root / 'providers/good.js').exists())

    def test_archive_symlink(self):
        entry = zipfile.ZipInfo('link')
        entry.create_system = 3
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(self.archive, 'w') as archive:
            archive.writestr(entry, '/tmp')
        with self.assertRaises(ValueError):
            patch.apply_zip(self.archive, self.root)

    def test_existing_symlink(self):
        (self.root / 'providers').symlink_to(self.root, target_is_directory=True)
        self.make({'providers/new.js': 'bad'})
        with self.assertRaises(ValueError):
            patch.apply_zip(self.archive, self.root)

    def test_file_parent_rejects_before_writes(self):
        (self.root / 'blocked').write_text('original')
        self.make({'providers/good.js': 'good', 'blocked/file': 'bad'})
        with self.assertRaises(ValueError):
            patch.apply_zip(self.archive, self.root)
        self.assertFalse((self.root / 'providers/good.js').exists())
        self.assertEqual((self.root / 'blocked').read_text(), 'original')

    def test_selection(self):
        self.make({'manifest.json': '{}'})
        self.assertEqual(patch.select_zip(self.root), self.archive)
        (self.root / 'second.zip').write_bytes(b'')
        with self.assertRaises(ValueError):
            patch.select_zip(self.root)
        self.assertEqual(patch.select_zip(self.root, 'patch.zip'), self.archive)
        with self.assertRaises(ValueError):
            patch.select_zip(self.root, '../patch.zip')

    def test_push_selects_only_changed_zip(self):
        import subprocess
        from unittest.mock import patch as mock
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.make({'manifest.json': '{}'})
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], check=True)
        def commit():
            subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'test'], check=True)
        commit()
        before = subprocess.check_output(['git', '-C', str(self.root), 'rev-parse', 'HEAD']).decode().strip()
        new = self.root / 'new.zip'
        new.write_bytes(self.archive.read_bytes())
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], check=True)
        commit()
        with mock.dict('os.environ', {'GITHUB_EVENT_NAME': 'push'}):
            self.assertEqual(patch.select_zip(self.root, event={'before': before}), new)
            current = subprocess.check_output(['git', '-C', str(self.root), 'rev-parse', 'HEAD']).decode().strip()
            self.assertIsNone(patch.select_zip(self.root, event={'before': current}))


if __name__ == '__main__':
    unittest.main()
