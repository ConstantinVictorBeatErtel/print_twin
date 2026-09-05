import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import numpy as np
import trimesh

spec = importlib.util.spec_from_file_location('verify_room_scale',Path(__file__).resolve().parents[1]/'scripts/verify_room_scale.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ScaleTests(unittest.TestCase):
    def test_scaled_export_survives_world_node_name_collision(self):
        with tempfile.TemporaryDirectory() as temp:
            source,output=Path(temp)/'source.glb',Path(temp)/'scaled.glb'
            trimesh.creation.box(extents=[2,4,6]).export(source)
            report={'meshSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                    'uniformScaleToNominalMeters':.5,'measurementConfidence':'test'}
            module.write_scaled_mesh(source,output,report)
            np.testing.assert_allclose(trimesh.load_scene(output).bounds,trimesh.load_scene(source).bounds*.5)

    def test_independent_distortion_fails_even_when_reference_is_exact(self):
        with tempfile.TemporaryDirectory() as temp:
            mesh = Path(temp)/'fixture.glb'
            mesh.write_bytes(b'fixture-content-only-for-hash')
            measurement = {'meshSha256':hashlib.sha256(mesh.read_bytes()).hexdigest(),
                'calibration':{'points':[[0,0,0],[2,0,0]],'measuredMm':1000},
                'check':{'points':[[0,0,0],[0,4,0]],'measuredMm':1000}}
            result = module.verify(measurement,mesh)
            self.assertEqual(result['uniformScaleToNominalMeters'],.5)
            self.assertFalse(result['nominalCheckPass'])
            self.assertEqual(result['independentCheckAbsoluteErrorMm'],1000)
            measurement['check']['points']=[[0,0,0],[0,2,0]]
            self.assertTrue(module.verify(measurement,mesh)['nominalCheckPass'])
            measurement['check']['points']=[[2,0,0],[0,0,0]]
            with self.assertRaises(ValueError): module.verify(measurement,mesh)
            measurement['meshSha256']='wrong'
            with self.assertRaises(ValueError): module.verify(measurement,mesh)


if __name__ == '__main__':
    unittest.main()
