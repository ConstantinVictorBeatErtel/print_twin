"""Calibrate one measured span and independently check another; save a transform.

Input points must be picked on the named GLB in its scene/world coordinates.
This does not infer real dimensions from model-generated metric metadata.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np


def write_scaled_mesh(mesh, output, report):
    """Wrap scene roots with one uniform transform; retain geometry/texture bytes."""
    mesh, output = Path(mesh), Path(output)
    if output.exists() or mesh.resolve() == output.resolve():
        raise ValueError('Scaled mesh must be a new file')
    data = mesh.read_bytes()
    if hashlib.sha256(data).hexdigest() != report['meshSha256']:
        raise ValueError('Mesh changed since scale verification')
    if struct.unpack_from('<4sII',data) != (b'glTF',2,len(data)):
        raise ValueError('Expected a GLB 2 file')
    length, kind = struct.unpack_from('<II',data,12)
    if kind != 0x4e4f534a:
        raise ValueError('Expected GLB JSON chunk')
    document = json.loads(data[20:20+length])
    if not document.get('scenes'):
        raise ValueError('Missing scene roots')
    # Trimesh reserves "world" as its base frame and can otherwise ignore a
    # parent transform when an imported child has that name. Rename the label
    # only; geometry, node indices, animation targets and transforms are intact.
    names = {node.get('name') for node in document.get('nodes',[])}
    for index,node in enumerate(document.get('nodes',[])):
        if node.get('name') == 'world':
            label = f'original-world-node-{index}'
            while label in names:
                label += '-source'
            node['name'] = label
            names.add(label)
    factor = report['uniformScaleToNominalMeters']
    matrix = report.get('meshToNominalMeters',np.diag([factor,factor,factor,1.]).flatten(order='F').tolist())
    for scene in document['scenes']:
        document.setdefault('nodes',[]).append({'name':'Room coordinate and nominal scale transform',
            'children':scene.get('nodes',[]),'matrix':matrix,
            'extras':{'sourceMeshSha256':report['meshSha256'],'metricAccuracyCertified':False,
                      'measurementConfidence':report['measurementConfidence']}})
        scene['nodes']=[len(document['nodes'])-1]
    encoded=json.dumps(document,separators=(',',':')).encode()
    encoded+=b' '*(-len(encoded)%4)
    rest=data[20+length:]
    output.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(rest))+
                       struct.pack('<II',len(encoded),0x4e4f534a)+encoded+rest)
    return {'file':output.name,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
            'scaleBakedIntoSceneRoots':True,'geometryAndTextureChunksPreserved':True}


def verify(measurement, mesh):
    mesh = Path(mesh)
    digest = hashlib.sha256(mesh.read_bytes()).hexdigest()
    if measurement['meshSha256'] != digest:
        raise ValueError('Measurements belong to a different mesh')
    spans = []
    for name in ['calibration','check']:
        span = measurement[name]
        points = np.asarray(span['points'],dtype=float)
        measured = float(span['measuredMm'])
        if points.shape != (2,3) or not np.isfinite(points).all() or not np.isfinite(measured) or measured <= 0:
            raise ValueError('Expected two finite XYZ points and a positive physical distance')
        length = float(np.linalg.norm(points[1]-points[0]))
        if length <= 1e-8:
            raise ValueError('Coincident picked endpoints')
        spans.append((points,measured,length))
    a,b = spans
    if np.allclose(a[0],b[0]) or np.allclose(a[0],b[0][::-1]):
        raise ValueError('Verification must use a different span')
    factor = a[1] / 1000 / a[2]
    predicted = b[2] * factor * 1000
    error = abs(predicted-b[1])
    threshold = max(20.,b[1]*.05)
    transform = np.diag([factor,factor,factor,1.])
    return {'meshFile':mesh.name,'meshSha256':digest,'measurements':measurement,
            'uniformScaleToNominalMeters':factor,'meshToNominalMeters':transform.flatten(order='F').tolist(),
            'matrixOrder':'column-major','calibrationMeasuredMm':a[1],
            'independentCheckMeasuredMm':b[1],'independentCheckPredictedMm':predicted,
            'independentCheckAbsoluteErrorMm':error,'independentCheckRelativeError':error/b[1],
            'demoToleranceMm':threshold,'nominalCheckPass':bool(error<=threshold),
            'measurementConfidence':measurement.get('measurementConfidence','unspecified'),
            'metricAccuracyCertified':False,
            'note':'One uniform scale cannot correct local distortion. Phone case/counting uncertainty is not bounded; nominal agreement is not certified physical accuracy.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('measurement')
    parser.add_argument('mesh')
    parser.add_argument('--out',required=True)
    parser.add_argument('--scaled-mesh',help='Optional nominally scaled derivative; never overwrites the source')
    args = parser.parse_args()
    report = verify(json.loads(Path(args.measurement).read_text()),args.mesh)
    if args.scaled_mesh:
        report['scaledMesh']=write_scaled_mesh(args.mesh,args.scaled_mesh,report)
    Path(args.out).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
