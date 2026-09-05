"""Verify saved world checksums and basic file structure; does not validate room accuracy."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import struct

from PIL import Image


def verify(directory):
    root = Path(directory).resolve()
    manifest = json.loads((root/'manifest.json').read_text())
    results = {}
    for key, asset in manifest['assets'].items():
        path = (root/asset['path']).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Asset path escapes world directory')
        with path.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        if digest != asset['sha256'] or path.stat().st_size != asset['bytes']:
            raise ValueError(f'Checksum/size mismatch: {key}')
        result = {'sha256Verified': True, 'bytes': asset['bytes']}
        if path.suffix == '.spz':
            with path.open('rb') as source:
                signature = source.read(4)
            if signature[:2] == b'\x1f\x8b':
                with gzip.open(path, 'rb') as source:
                    header = source.read(16)
                    while source.read(1024 * 1024):
                        pass  # Read to EOF to verify the gzip CRC.
                compression = 'gzip'
            elif signature == b'NGSP':
                header = path.read_bytes()[:32]
                compression = 'zstd (header checked only)'
            else:
                raise ValueError(f'Not an SPZ file: {key}')
            magic, version, points = struct.unpack('<III',header[:12])
            if magic != 0x5053474e or version not in {1,2,3,4} or points <= 0:
                raise ValueError(f'Invalid SPZ header: {key}')
            result.update(format='SPZ',version=version,points=points,compression=compression)
        elif path.suffix == '.glb':
            data = path.read_bytes()
            magic, version, length = struct.unpack('<4sII',data[:12])
            if magic != b'glTF' or version != 2 or length != len(data):
                raise ValueError('Invalid GLB header')
            json_length, chunk_type = struct.unpack('<II',data[12:20])
            if chunk_type != 0x4e4f534a:
                raise ValueError('Missing GLB JSON chunk')
            document = json.loads(data[20:20+json_length])
            meshes = document.get('meshes', [])
            if not meshes:
                raise ValueError('Collider has no meshes')
            primitives = [p for mesh in meshes for p in mesh.get('primitives', [])]
            if not primitives:
                raise ValueError('Collider has no primitives')
            accessors = document.get('accessors', [])
            vertices = sum(accessors[p['attributes']['POSITION']]['count'] for p in primitives)
            if vertices <= 0:
                raise ValueError('Collider has no vertices')
            result.update(format='GLB 2.0',meshes=len(meshes),primitives=len(primitives),vertices=vertices)
        else:
            with Image.open(path) as image:
                result.update(format=image.format,width=image.width,height=image.height)
                image.verify()
        results[key] = result
    report = {'worldId':manifest['worldId'],'fileIntegrity':'pass','assets':results,
              'geometryAccuracy':'not_measured','colliderSplatAlignment':'not_checked',
              'browserRendering':'not_checked'}
    (root/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    args = parser.parse_args()
    print(json.dumps(verify(args.directory),indent=2))
