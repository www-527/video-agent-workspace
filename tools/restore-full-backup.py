"""Restore the encrypted GitHub Release snapshot; never overwrites an existing folder."""
import argparse, base64, gzip, hashlib, io, json, os, pathlib, tarfile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b'VABACKUP1'

def longpath(path):
    value = str(pathlib.Path(path).absolute())
    return '\\\\?\\' + value if os.name == 'nt' and not value.startswith('\\\\?\\') else value

class PartsReader(io.RawIOBase):
    def __init__(self, folder, manifest, key):
        self.folder = pathlib.Path(folder)
        self.parts = iter(manifest['parts'])
        self.aes = AESGCM(key)
        self.backup_id = manifest['backup_id']
        self.data = memoryview(b'')
    def readable(self): return True
    def readinto(self, target):
        if not self.data:
            try: part = next(self.parts)
            except StopIteration: return 0
            payload = (self.folder / part['name']).read_bytes()
            if hashlib.sha256(payload).hexdigest() != part['sha256']:
                raise ValueError('Damaged or incomplete part: ' + part['name'])
            if not payload.startswith(MAGIC): raise ValueError('Invalid part format')
            offset = len(MAGIC)
            aad = (self.backup_id + ':' + str(part['index'])).encode()
            self.data = memoryview(self.aes.decrypt(payload[offset:offset+12], payload[offset+12:], aad))
        count = min(len(target), len(self.data))
        target[:count] = self.data[:count]
        self.data = self.data[count:]
        return count

def process(folder, key_file, destination=None):
    folder = pathlib.Path(folder)
    manifest = json.loads((folder/'backup-manifest.json').read_text(encoding='utf-8'))
    key = base64.urlsafe_b64decode(pathlib.Path(key_file).read_text(encoding='ascii').strip())
    if len(key) != 32: raise ValueError('Expected a 32-byte recovery key')
    dest = pathlib.Path(destination).absolute() if destination else None
    if dest:
        if dest.exists(): raise ValueError('Choose a new, nonexistent destination directory')
        dest.mkdir(parents=True)
    observed = {}; expected = None; total = 0
    raw = io.BufferedReader(PartsReader(folder, manifest, key), buffer_size=1024*1024)
    with gzip.GzipFile(fileobj=raw, mode='rb') as compressed:
        with tarfile.open(fileobj=compressed, mode='r|') as archive:
            for member in archive:
                name = member.name
                parts = pathlib.PurePosixPath(name).parts
                if not parts or any(p in ('..','') or ':' in p for p in parts) or name.startswith('/') or '\\' in name:
                    raise ValueError('Unsafe archive path: '+name)
                target = pathlib.Path(longpath(dest.joinpath(*parts))) if dest else None
                if member.isdir():
                    if target: target.mkdir(parents=True, exist_ok=True)
                    continue
                if not member.isfile(): raise ValueError('Unsupported archive entry: '+name)
                source = archive.extractfile(member)
                if name == '_backup/file-manifest.json':
                    body = source.read()
                    expected = json.loads(body)
                    if target:
                        target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(body)
                    continue
                if name in observed: raise ValueError('Duplicate file: '+name)
                digest = hashlib.sha256(); size = 0
                out = None
                try:
                    if target:
                        target.parent.mkdir(parents=True, exist_ok=True); out = target.open('xb')
                    while block := source.read(1024*1024):
                        digest.update(block); size += len(block)
                        if out: out.write(block)
                finally:
                    if out: out.close()
                if target: os.utime(target, (member.mtime, member.mtime))
                observed[name] = {'size':size, 'sha256':digest.hexdigest()}
                total += size
                if len(observed)%10000 == 0: print('Verified files:',len(observed),flush=True)
        # Consume the gzip footer and authenticate all remaining encrypted parts.
        if compressed.read(): raise ValueError('Unexpected data after tar archive')
    if expected is None or observed != expected['files']:
        raise ValueError('File manifest does not match the restored snapshot')
    if len(observed) != manifest['file_count'] or total != manifest['uncompressed_file_bytes']:
        raise ValueError('Snapshot totals mismatch')
    print(json.dumps({'verified_files':len(observed),'verified_bytes':total,'destination':str(dest) if dest else 'verification only'}),flush=True)
    return observed

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', required=True)
    parser.add_argument('--key-file', required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--destination')
    group.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    process(args.backup, args.key_file, args.destination)
