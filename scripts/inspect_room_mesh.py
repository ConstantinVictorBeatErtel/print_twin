"""Serve a local-only GLB inspector with three-point window measurement picking."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory')
parser.add_argument('--port',type=int,default=8766)
args = parser.parse_args()
root = Path(args.directory).resolve()
scripts = Path(__file__).resolve().parent
three = scripts.parent/'node_modules/three'
if not three.exists():
    three = scripts.parent/'data/mesh-preview-deps/node_modules/three'
if not three.exists():
    raise SystemExit('Install three locally: npm install --prefix data/mesh-preview-deps three@0.180.0')


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == '/files':
            data = json.dumps(sorted(p.name for p in root.glob('*.glb'))).encode()
            kind = 'application/json'
        elif path == '/':
            data = (scripts/'room_mesh_inspector.html').read_bytes()
            kind = 'text/html'
        else:
            if path.startswith('/mesh/'):
                base, relative, kind = root, path[6:], 'model/gltf-binary'
            elif path.startswith('/three/'):
                base, relative, kind = three, path[7:], 'text/javascript'
            else:
                self.send_error(404)
                return
            target = (base/relative).resolve()
            if not target.is_relative_to(base) or not target.is_file() or target.suffix not in {'.js','.glb'}:
                self.send_error(404)
                return
            data = target.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self,*args):
        pass


print(f'Mesh inspector: http://127.0.0.1:{args.port}',flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
