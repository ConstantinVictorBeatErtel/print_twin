"""Conservative GLB cleanup: remove invalid triangles without resampling textures.

Keeps original vertex attributes, images, materials and transforms byte-for-byte
in the embedded BIN chunk. Writes new triangle indices only. Open architectural
boundaries and disconnected objects are audited, not automatically filled/deleted.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
import trimesh


def read_glb(path):
    data = Path(path).read_bytes()
    magic, version, size = struct.unpack_from('<4sII', data)
    if (magic, version, size) != (b'glTF', 2, len(data)):
        raise ValueError('Invalid GLB 2 header')
    offset, document, binary = 12, None, None
    while offset < len(data):
        length, kind = struct.unpack_from('<II', data, offset)
        chunk = data[offset + 8:offset + 8 + length]
        if kind == 0x4e4f534a:
            document = json.loads(chunk)
        elif kind == 0x004e4942:
            binary = bytearray(chunk)
        else:
            raise ValueError('Unknown GLB chunk; refusing lossy conversion')
        offset += length + 8
    if document is None or binary is None or len(document['buffers']) != 1:
        raise ValueError('Expected one embedded GLB buffer')
    return document, binary


def accessor(doc, binary, index):
    a = doc['accessors'][index]
    if 'sparse' in a:
        raise ValueError('Sparse accessor requires a separate lossless decoder')
    view = doc['bufferViews'][a['bufferView']]
    if view.get('buffer', 0) != 0 or view.get('extensions'):
        raise ValueError('External/compressed buffer is not supported')
    dtype = np.dtype({5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']])
    width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    start = view.get('byteOffset',0) + a.get('byteOffset',0)
    stride = view.get('byteStride',width * dtype.itemsize)
    return np.ndarray((a['count'], width), dtype=dtype, buffer=binary,
                      offset=start, strides=(stride,dtype.itemsize)).copy()


def topology(vertices, faces):
    # Weld exact coincident positions in the audit copy only; UV seams stay intact.
    positions, inverse = np.unique(vertices, axis=0, return_inverse=True)
    mesh = trimesh.Trimesh(positions, inverse[faces], process=False)
    mesh.remove_unreferenced_vertices()
    edges, counts = np.unique(mesh.edges_sorted, axis=0, return_counts=True)
    return {'boundaryEdges':int(np.count_nonzero(counts == 1)),
            'nonManifoldEdges':int(np.count_nonzero(counts > 2)),
            'watertight':bool(mesh.is_watertight),
            'windingConsistent':bool(mesh.is_winding_consistent),
            'connectedVertexComponents':int(mesh.body_count)}


def clean(source, output):
    source, output = Path(source), Path(output)
    if source.resolve() == output.resolve() or output.exists():
        raise ValueError('Write a new output file; never overwrite the source')
    doc, binary = read_glb(source)
    original_binary = bytes(binary)
    records = []
    for mi, mesh in enumerate(doc.get('meshes',[])):
        for pi, primitive in enumerate(mesh['primitives']):
            if primitive.get('mode',4) != 4 or primitive.get('extensions'):
                raise ValueError('Expected uncompressed triangle primitives')
            vertices = accessor(doc,binary,primitive['attributes']['POSITION']).astype(float)
            if not np.isfinite(vertices).all():
                raise ValueError('Nonfinite positions require manual review')
            indices = (accessor(doc,binary,primitive['indices']).ravel() if 'indices' in primitive
                       else np.arange(len(vertices)))
            if len(indices) % 3 or indices.max() >= len(vertices):
                raise ValueError('Invalid triangle indices')
            faces = indices.reshape(-1,3)
            triangles = vertices[faces]
            cross = np.cross(triangles[:,1]-triangles[:,0], triangles[:,2]-triangles[:,0])
            valid = np.any(cross != 0,axis=1)
            # Cyclic rotations describe the same oriented face. Opposite winding
            # may intentionally represent a two-sided surface and is preserved.
            canonical = np.take_along_axis(faces, (np.arange(3)[None,:] + faces.argmin(axis=1)[:,None]) % 3,axis=1)
            _, unique = np.unique(canonical, axis=0, return_index=True)
            keep = np.zeros(len(faces),dtype=bool)
            keep[unique] = True
            keep &= valid
            cleaned = faces[keep]
            if not len(cleaned):
                raise ValueError('Cleanup would empty a primitive; inspect manually')
            record = {'mesh':mi,'primitive':pi,'vertices':len(vertices),'facesBefore':len(faces),
                      'facesAfter':len(cleaned),'degenerateFacesRemoved':int((~valid).sum()),
                      'duplicateFacesRemoved':int((valid & ~keep).sum()),
                      'localBounds': [vertices.min(axis=0).tolist(),vertices.max(axis=0).tolist()],
                      'topologyAfter':topology(vertices,cleaned)}
            records.append(record)
            if not keep.all():
                binary.extend(b'\x00' * (-len(binary) % 4))
                offset = len(binary)
                new_indices = cleaned.astype('<u4').tobytes()
                binary.extend(new_indices)
                doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(new_indices),'target':34963})
                doc['accessors'].append({'bufferView':len(doc['bufferViews'])-1,'componentType':5125,
                                         'count':int(cleaned.size),'type':'SCALAR',
                                         'min':[int(cleaned.min())],'max':[int(cleaned.max())]})
                primitive['indices'] = len(doc['accessors'])-1
    if not records:
        raise ValueError('No meshes')
    doc['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(doc,separators=(',',':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary.extend(b'\x00' * (-len(binary) % 4))
    payload = (struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(binary)) +
               struct.pack('<II',len(encoded),0x4e4f534a)+encoded+
               struct.pack('<II',len(binary),0x004e4942)+binary)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(payload)
    _, restored = read_glb(output)
    if restored[:len(original_binary)] != original_binary:
        raise ValueError('Original vertex/texture payload changed')
    scene = trimesh.load_scene(output,process=False)
    report = {'sourceFile':source.name,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
              'outputFile':output.name,'outputSha256':hashlib.sha256(payload).hexdigest(),
              'originalBufferPreserved':True,'textureCount':len(doc.get('images',[])),
              'materialCount':len(doc.get('materials',[])),'sceneBounds':scene.bounds.tolist(),
              'primitives':records,'scaleVerification':'pending_physical_reference',
              'selfIntersections':'not_checked','printReady':False,
              'policy':'No decimation, smoothing, texture recompression, automatic hole filling or component deletion.'}
    output.with_suffix('.audit.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('output')
    args = parser.parse_args()
    print(json.dumps(clean(args.source,args.output),indent=2))
