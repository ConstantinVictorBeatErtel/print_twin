import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image
import trimesh

spec = importlib.util.spec_from_file_location('clean_room_mesh',Path(__file__).resolve().parents[1]/'scripts/clean_room_mesh.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MeshCleanupTests(unittest.TestCase):
    def test_textured_open_surface_keeps_pixels_and_uvs(self):
        vertices = np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0]],dtype=float)
        # Valid square plus a cyclic duplicate and a zero-area triangle.
        mesh = trimesh.Trimesh(vertices,[[0,1,2],[0,2,3],[1,2,0],[0,0,1]],process=False)
        mesh.visual = trimesh.visual.texture.TextureVisuals(
            uv=vertices[:,:2],image=Image.new('RGB',(4,4),(127,80,30)))
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp)/'source.glb',Path(tmp)/'cleaned.glb'
            mesh.export(source)
            report = module.clean(source,output)
            self.assertTrue(report['originalBufferPreserved'])
            self.assertEqual(report['textureCount'],1)
            primitive = report['primitives'][0]
            self.assertEqual(primitive['facesAfter'],2)
            self.assertEqual(primitive['degenerateFacesRemoved'],1)
            self.assertEqual(primitive['duplicateFacesRemoved'],1)
            self.assertEqual(primitive['topologyAfter']['boundaryEdges'],4)
            self.assertFalse(primitive['topologyAfter']['watertight'])
            restored = next(iter(trimesh.load_scene(output,process=False).geometry.values()))
            np.testing.assert_array_equal(restored.visual.uv,vertices[:,:2])
            np.testing.assert_array_equal(np.asarray(restored.visual.material.baseColorTexture),np.asarray(mesh.visual.material.image))

    def test_closed_transformed_mesh_remains_closed(self):
        mesh = trimesh.creation.box(extents=[2,3,4])
        scene = trimesh.Scene()
        transform = np.eye(4)
        transform[:3,3]=[5,6,7]
        scene.add_geometry(mesh,transform=transform)
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp)/'source.glb',Path(tmp)/'cleaned.glb'
            scene.export(source)
            report = module.clean(source,output)
            self.assertEqual(report['primitives'][0]['facesAfter'],12)
            self.assertTrue(report['primitives'][0]['topologyAfter']['watertight'])
            np.testing.assert_allclose(report['sceneBounds'],scene.bounds)
            with self.assertRaises(ValueError):
                module.clean(source,source)


if __name__ == '__main__':
    unittest.main()
